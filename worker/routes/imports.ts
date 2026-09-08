import { Hono } from "hono";
import { ImportCommitSchema } from "@shared/schemas";
import type { AppVariables, Env } from "../env";
import { requireAuth } from "../lib/auth";
import { badRequest } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { commitImportJob, createImportJob, getImportJob, importTemplate, listImportJobs } from "../services/imports";
import { MAX_IMPORT_BYTES } from "../services/media";

const imports = new Hono<{ Bindings: Env; Variables: AppVariables }>();
imports.use("*", requireAuth("admin"));

imports.get("/", async (c) => c.json({ results: await listImportJobs(c.env) }));

imports.get("/template", async (c) => {
  const lang = c.get("lang");
  const bytes = importTemplate(lang);
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="flarefleet-import-${lang}.xlsx"`,
    },
  });
});

imports.post("/", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("validation", { file: "required" });
  if (file.size > MAX_IMPORT_BYTES) throw badRequest("media_too_large", undefined, { max: MAX_IMPORT_BYTES / 1024 / 1024 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const job = await createImportJob(c.env, c.get("user"), c.get("lang"), file.name, bytes, c.get("ip"));
  return c.json(job, 201);
});

imports.get("/:id", async (c) => c.json(await getImportJob(c.env, c.req.param("id"), true)));

imports.post("/:id/commit", async (c) => {
  const input = await parseBody(c, ImportCommitSchema);
  return c.json(await commitImportJob(c.env, c.get("user"), c.get("lang"), c.req.param("id"), input.only_valid, c.get("ip")));
});

export default imports;
