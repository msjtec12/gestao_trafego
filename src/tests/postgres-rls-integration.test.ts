// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

describe("PostgreSQL Real Disposable DB Integration — RLS, Composite FKs & Audit Immutability", () => {
  let pg: PGlite;

  const ORG_ALPHA = "11111111-1111-4111-8111-111111111111";
  const ORG_BETA = "22222222-2222-4222-8222-222222222222";
  const CLIENT_ALPHA = "aaaaaaaa-1111-4111-8111-111111111111";
  const CLIENT_BETA = "bbbbbbbb-2222-4222-8222-222222222222";
  const INTEGRATION_ALPHA = "cccccccc-1111-4111-8111-111111111111";
  const ACCOUNT_ALPHA = "dddddddd-1111-4111-8111-111111111111";

  beforeAll(async () => {
    pg = new PGlite();

    const migration0000 = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "drizzle/migrations/0000_confused_galactus.sql"
      ),
      "utf8"
    );
    const migration0001 = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "drizzle/migrations/0001_multi_tenant_rls_hardening.sql"
      ),
      "utf8"
    );

    await pg.exec(migration0000);
    await pg.exec(migration0001);

    // Seed two distinct organizations as table owner before testing konnexy_app RLS role
    await pg.exec(`
      INSERT INTO organizations (id, name, slug) VALUES
        ('${ORG_ALPHA}', 'Alpha Performance Agency', 'alpha-agency'),
        ('${ORG_BETA}', 'Beta Digital Group', 'beta-group');

      INSERT INTO clients (id, organization_id, name, industry) VALUES
        ('${CLIENT_ALPHA}', '${ORG_ALPHA}', 'Cliente Alpha Odontologia', 'Saude'),
        ('${CLIENT_BETA}', '${ORG_BETA}', 'Cliente Beta Imoveis', 'Imobiliario');

      INSERT INTO integrations (id, organization_id, provider, external_account_label) VALUES
        ('${INTEGRATION_ALPHA}', '${ORG_ALPHA}', 'MOCK_ADS', 'Mock Alpha Sandbox');

      INSERT INTO ad_accounts (id, organization_id, client_id, integration_id, provider, external_account_id, name) VALUES
        ('${ACCOUNT_ALPHA}', '${ORG_ALPHA}', '${CLIENT_ALPHA}', '${INTEGRATION_ALPHA}', 'MOCK_ADS', 'EXT-ALPHA-1', 'Conta Alpha 01');
    `);
  });

  afterAll(async () => {
    await pg.close();
  });

  it("enforces PostgreSQL Row-Level Security (USING) so Organization A cannot read Organization B records", async () => {
    const resAlpha = await pg.exec(`
      BEGIN;
      SET LOCAL ROLE konnexy_app;
      SELECT set_config('app.current_organization_id', '${ORG_ALPHA}', true);
      SELECT id, organization_id, name FROM clients;
      COMMIT;
    `);

    const rowsAlpha = resAlpha[3]?.rows ?? [];
    expect(rowsAlpha).toHaveLength(1);
    expect((rowsAlpha[0] as { id: string }).id).toBe(CLIENT_ALPHA);

    const resBeta = await pg.exec(`
      BEGIN;
      SET LOCAL ROLE konnexy_app;
      SELECT set_config('app.current_organization_id', '${ORG_BETA}', true);
      SELECT id, organization_id, name FROM clients;
      COMMIT;
    `);

    const rowsBeta = resBeta[3]?.rows ?? [];
    expect(rowsBeta).toHaveLength(1);
    expect((rowsBeta[0] as { id: string }).id).toBe(CLIENT_BETA);
  });

  it("enforces PostgreSQL Row-Level Security (WITH CHECK) blocking cross-tenant INSERT from Organization A into Organization B", async () => {
    await expect(
      pg.exec(`
        BEGIN;
        SET LOCAL ROLE konnexy_app;
        SELECT set_config('app.current_organization_id', '${ORG_ALPHA}', true);
        INSERT INTO clients (organization_id, name, industry)
          VALUES ('${ORG_BETA}', 'Cross-Tenant Spoofed Client', 'Fraude');
        COMMIT;
      `)
    ).rejects.toThrow(/row-level security policy/);
    await pg.exec("ROLLBACK;");
  });

  it("enforces composite foreign keys (organization_id, id) preventing cross-organization relational links", async () => {
    // Attempt to insert an ad_account under ORG_ALPHA that links to CLIENT_BETA (which belongs to ORG_BETA)
    await expect(
      pg.exec(`
        INSERT INTO ad_accounts (organization_id, client_id, integration_id, provider, external_account_id, name)
        VALUES ('${ORG_ALPHA}', '${CLIENT_BETA}', '${INTEGRATION_ALPHA}', 'MOCK_ADS', 'EXT-CROSS-99', 'Cross Org Link');
      `)
    ).rejects.toThrow(/ad_accounts_org_client_fk/);
  });

  it("protects audit_logs from UPDATE and premature DELETE via trigger and role privileges", async () => {
    const auditId = "eeeeeeee-1111-4111-8111-111111111111";
    await pg.exec(`
      INSERT INTO audit_logs (id, organization_id, actor_type, action, entity_type, entity_id, retention_until)
      VALUES ('${auditId}', '${ORG_ALPHA}', 'SYSTEM', 'KILL_SWITCH_TEST', 'organization', '${ORG_ALPHA}', NOW() + INTERVAL '365 days');
    `);

    await expect(
      pg.exec(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = '${auditId}';`)
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);

    await expect(
      pg.exec(`DELETE FROM audit_logs WHERE id = '${auditId}';`)
    ).rejects.toThrow(/AUDIT_LOG_RETENTION_LOCKED/);
  });
});
