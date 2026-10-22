import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`http://localhost/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Role": "owner" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json(),
  };
}

it("creates categorized tickets with optional resource and dynamic context", async () => {
  const created = await request("/tickets", "POST", {
    category: "billing",
    title: "Invoice total differs",
    message: "Please review the selected billing period.",
    priority: "high",
    region: "jp",
    resourceUuid: null,
    context: { billingPeriod: "2026-09", invoiceNumber: "INV-202609" },
  });
  expect(created.status).toBe(201);
  expect(created.data.category).toBe("billing");
  expect(created.data.resourceUuid).toBeNull();
  expect(created.data.caseNumber).toMatch(/^tkt-[a-f0-9]{16}$/);
  expect(created.data.events[0].status).toBe("open");
  expect((await request("/tickets?region=jp&category=billing")).data).toHaveLength(1);
});

it("requires and validates resources for resource-specific categories", async () => {
  const gpuVm = db.resources.find((resource) => resource.kind === "gpu_vm")!;
  const baremetal = db.resources.find((resource) => resource.kind === "gpu_baremetal")!;
  const base = {
    category: "gpu_vm",
    title: "Instance boot failure",
    message: "The instance does not finish startup.",
    priority: "normal",
    region: gpuVm.region,
  };
  expect((await request("/tickets", "POST", base)).data.code).toBe("TICKET_RESOURCE_REQUIRED");
  expect((await request("/tickets", "POST", { ...base, resourceUuid: baremetal.resourceUuid })).data.code).toBe("TICKET_RESOURCE_MISMATCH");
  const result = await request("/tickets", "POST", { ...base, resourceUuid: gpuVm.resourceUuid });
  expect(result.status).toBe(201);
  expect(result.data.resourceUuid).toBe(gpuVm.resourceUuid);
});

it("stores downloadable attachments with the ticket and its replies", async () => {
  const created = await request("/tickets", "POST", {
    category: "technical",
    title: "Driver diagnostic logs",
    message: "Please inspect this log file.",
    priority: "normal",
    region: "sg",
    context: { topic: "api" },
    attachments: [{
      name: "diagnostic.txt",
      size: 5,
      contentType: "text/plain",
      content: "data:text/plain;base64,SGVsbG8=",
    }],
  });
  expect(created.status).toBe(201);
  const attachment = created.data.messages[0].attachments[0];
  const downloaded = await request(`/tickets/${created.data.id}/attachments/${attachment.id}`);
  expect(downloaded.data.content).toBe("data:text/plain;base64,SGVsbG8=");
  const reply = await request(`/tickets/${created.data.id}`, "PATCH", {
    message: "I added one more detail.",
    attachments: [],
  });
  expect(reply.data.messages).toHaveLength(2);
  expect(reply.data.updatedAt).toBe(reply.data.messages[1].at);
  expect(reply.data.events.at(-1).type).toBe("reply");
});

it("tracks resolution, close, reopen, and rejects replies to closed tickets", async () => {
  const ticket = db.tickets[0];
  const missingResolution = await request(`/tickets/${ticket.id}`, "PATCH", {
    status: "resolved",
    resolution: "  ",
  });
  expect(missingResolution.data.code).toBe("VALIDATION_ERROR");
  const resolved = await request(`/tickets/${ticket.id}`, "PATCH", {
    status: "resolved",
    resolution: "Quota adjusted for the project.",
  });
  expect(resolved.data.status).toBe("resolved");
  expect(resolved.data.resolvedAt).toBeTruthy();
  const closed = await request(`/tickets/${ticket.id}`, "PATCH", { status: "closed" });
  expect(closed.data.status).toBe("closed");
  expect((await request(`/tickets/${ticket.id}`, "PATCH", { message: "Another update." })).data.code).toBe("TICKET_CLOSED");
  const reopened = await request(`/tickets/${ticket.id}`, "PATCH", { status: "open" });
  expect(reopened.data.status).toBe("open");
  expect(reopened.data.resolvedAt).toBeNull();
});

it("moves a ticket back to open when the requester supplies pending information", async () => {
  const ticket = db.tickets[1];
  expect(ticket.status).toBe("pending");
  const response = await request(`/tickets/${ticket.id}`, "PATCH", {
    message: "The issue still reproduces after restarting the service.",
  });
  expect(response.data.status).toBe("open");
  expect(response.data.events.at(-1).summary).toBe("tickets.eventReopened");
});
