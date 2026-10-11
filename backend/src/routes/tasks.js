// /api/v1/tasks の 4 操作（契約: backend/openapi.yaml）。
import { AppError } from "../errors.js";
import { validateTitle } from "../domain/title.js";
import { parseCreateBody, parseId, parseUpdateBody } from "../http/request.js";

export function registerTaskRoutes(app, { store, clock, idGenerator }) {
  app.get("/api/v1/tasks", async () => ({ tasks: store.listTasks() }));

  app.post("/api/v1/tasks", async (request, reply) => {
    const result = validateTitle(parseCreateBody(request.body));
    if (!result.ok) throw new AppError(result.code);
    const task = store.createTask({
      id: idGenerator(),
      title: result.title,
      completed: false,
      createdAt: clock(),
    });
    return reply.code(201).send(task);
  });

  app.patch("/api/v1/tasks/:id", async (request) => {
    const id = parseId(request.params.id);
    const completed = parseUpdateBody(request.body);
    const task = store.setCompleted(id, completed);
    if (!task) throw new AppError("TASK_NOT_FOUND");
    return task;
  });

  app.delete("/api/v1/tasks/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (!store.deleteTask(id)) throw new AppError("TASK_NOT_FOUND");
    return reply.code(204).send();
  });
}
