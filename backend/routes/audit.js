// backend/routes/audit.js (ESM)
import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

async function resolveDatasetIdFlexible(idParam) {
  const idText = String(idParam || "").trim();

  if (/^\d+$/.test(idText)) return Number(idText);

  if (idText.includes("-")) {
    const rows = await prisma.$queryRaw`
      select old_dataset_id
      from ops.dataset_map
      where dataset_id = ${idText}
      limit 1
    `;

    if (rows.length && Number.isFinite(rows[0].old_dataset_id))
      return Number(rows[0].old_dataset_id);

    throw new Error("Unknown dataset UUID (cannot map to numeric id)");
  }

  throw new Error("Invalid dataset id format");
}

// GET /api/audit/facets  -> {actors:[{actor}], actions:[{action}], datasets:[{dataset_id,name}]}
router.get("/facets", async (_req, res) => {
  try {
    const actors = await prisma.$queryRawUnsafe(`
      select distinct actor from ops.audit_log where actor is not null order by actor
    `);
    const actions = await prisma.$queryRawUnsafe(`
      select distinct action from ops.audit_log where action is not null order by action
    `);
    const datasets = await prisma.$queryRawUnsafe(`
      select id as dataset_id, name from datasets order by upload_date desc nulls last, id desc
    `);

    res.json({ actors, actions, datasets });
  } catch (e) {
    console.error("audit_facets_failed:", e);
    res.status(500).json({ message: "audit_facets_failed", detail: e.message });
  }
});

// GET /api/audit?datasetId=&actor=&action=&from=&to=&limit=&offset=
router.get("/", async (req, res) => {
  try {
    const raw = req.query || {};
    const limit = Math.min(parseInt(raw.limit || "50", 10), 200);
    const offset = parseInt(raw.offset || "0", 10);

    let datasetId = null;
    if (raw.datasetId) {
      try {
        datasetId = await resolveDatasetIdFlexible(raw.datasetId);
      } catch {
        // ignore
      }
    }

    const params = [];
    const where = [];

    if (datasetId != null) {
      params.push(datasetId);
      where.push(`al.dataset_id = $${params.length}`);
    }
    if (raw.actor) {
      params.push(String(raw.actor));
      where.push(`al.actor = $${params.length}`);
    }
    if (raw.action) {
      params.push(String(raw.action));
      where.push(`al.action = $${params.length}`);
    }
    if (raw.from) {
      params.push(String(raw.from));
      where.push(`al.created_at >= $${params.length}`);
    }
    if (raw.to) {
      params.push(String(raw.to));
      where.push(`al.created_at <= $${params.length}`);
    }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const items = await prisma.$queryRawUnsafe(
      `
      select
        al.audit_id,
        al.created_at,
        al.actor,
        al.action,
        d.name as dataset_name,
        al.field_name,
        al.old_value,
        al.new_value,
        al.note
      from ops.audit_log al
      left join datasets d on d.id = al.dataset_id
      ${whereSql}
      order by al.created_at desc
      limit ${limit} offset ${offset}
    `,
      ...params
    );

    const totalRows = await prisma.$queryRawUnsafe(
      `
      select count(*)::int as c
      from ops.audit_log al
      ${whereSql}
    `,
      ...params
    );

    res.json({ total: totalRows?.[0]?.c || 0, items: items || [] });
  } catch (e) {
    console.error("audit_list_failed:", e);
    res.status(500).json({ message: "audit_list_failed", detail: e.message });
  }
});

export default router;