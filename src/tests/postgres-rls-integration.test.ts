// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "fs";
import path from "path";
import * as schema from "@/infrastructure/db/schema";
import {
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import type { TenantContext } from "@/domain/types";

describe("PostgreSQL Real Disposable DB Integration — RLS, Composite FKs, Table Grants & Drizzle Repositories", () => {
  let pg: PGlite;

  const ORG_ALPHA = "11111111-1111-4111-8111-111111111111";
  const ORG_BETA = "22222222-2222-4222-8222-222222222222";
  const CLIENT_ALPHA = "aaaaaaaa-1111-4111-8111-111111111111";
  const CLIENT_BETA = "bbbbbbbb-2222-4222-8222-222222222222";
  const INTEGRATION_ALPHA = "cccccccc-1111-4111-8111-111111111111";
  const ACCOUNT_ALPHA = "dddddddd-1111-4111-8111-111111111111";
  const CAMPAIGN_ALPHA = "ffffffff-1111-4111-8111-111111111111";
  const CAMPAIGN_BETA = "ffffffff-2222-4222-8222-222222222222";
  const INTEGRATION_BETA = "cccccccc-2222-4222-8222-222222222222";
  const ACCOUNT_BETA = "dddddddd-2222-4222-8222-222222222222";

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
    const migration0002 = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "drizzle/migrations/0002_stage2_auth_rls_and_sync.sql"
      ),
      "utf8"
    );
    const migration0003 = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_stage2_1_operational_persistence.sql"
      ),
      "utf8"
    );

    await pg.exec(migration0000);
    await pg.exec(migration0001);
    await pg.exec(migration0002);
    await pg.exec(migration0003);

    await pg.exec(`
      INSERT INTO organizations (id, name, slug) VALUES
        ('${ORG_ALPHA}', 'Alpha Performance Agency', 'alpha-agency'),
        ('${ORG_BETA}', 'Beta Digital Group', 'beta-group');

      INSERT INTO clients (id, organization_id, name, industry) VALUES
        ('${CLIENT_ALPHA}', '${ORG_ALPHA}', 'Cliente Alpha Odontologia', 'Saude'),
        ('${CLIENT_BETA}', '${ORG_BETA}', 'Cliente Beta Imoveis', 'Imobiliario');

      INSERT INTO integrations (id, organization_id, provider, external_account_label) VALUES
        ('${INTEGRATION_ALPHA}', '${ORG_ALPHA}', 'MOCK_ADS', 'Mock Alpha Sandbox'),
        ('${INTEGRATION_BETA}', '${ORG_BETA}', 'MOCK_ADS', 'Mock Beta Sandbox');

      INSERT INTO ad_accounts (id, organization_id, client_id, integration_id, provider, external_account_id, name) VALUES
        ('${ACCOUNT_ALPHA}', '${ORG_ALPHA}', '${CLIENT_ALPHA}', '${INTEGRATION_ALPHA}', 'MOCK_ADS', 'EXT-ALPHA-1', 'Conta Alpha 01'),
        ('${ACCOUNT_BETA}', '${ORG_BETA}', '${CLIENT_BETA}', '${INTEGRATION_BETA}', 'MOCK_ADS', 'EXT-BETA-1', 'Conta Beta 01');

      INSERT INTO campaigns (id, organization_id, ad_account_id, provider, external_campaign_id, name, channel_type, bidding_strategy) VALUES
        ('${CAMPAIGN_ALPHA}', '${ORG_ALPHA}', '${ACCOUNT_ALPHA}', 'MOCK_ADS', 'CAMP-ALPHA-1', 'Campanha Alpha Search', 'SEARCH', 'TARGET_CPA'),
        ('${CAMPAIGN_BETA}', '${ORG_BETA}', '${ACCOUNT_BETA}', 'MOCK_ADS', 'CAMP-BETA-1', 'Campanha Beta Search', 'SEARCH', 'TARGET_CPA');
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

  it("enforces composite foreign keys on both required and optional relationships (budgets.campaign_id)", async () => {
    // Required FK: ad_account under ORG_ALPHA linking to CLIENT_BETA
    await expect(
      pg.exec(`
        INSERT INTO ad_accounts (organization_id, client_id, integration_id, provider, external_account_id, name)
        VALUES ('${ORG_ALPHA}', '${CLIENT_BETA}', '${INTEGRATION_ALPHA}', 'MOCK_ADS', 'EXT-CROSS-99', 'Cross Org Link');
      `)
    ).rejects.toThrow(/ad_accounts_org_client_fk/);

    // Optional FK (Phase 1 fix): budget under ORG_ALPHA linking to optional CAMPAIGN_BETA (which belongs to ORG_BETA)
    await expect(
      pg.exec(`
        INSERT INTO budgets (organization_id, client_id, campaign_id, period_month, allocated_cents, max_daily_hard_limit_cents)
        VALUES ('${ORG_ALPHA}', '${CLIENT_ALPHA}', '${CAMPAIGN_BETA}', '2026-11', 500000, 25000);
      `)
    ).rejects.toThrow(/budgets_org_campaign_fk/);
  });

  it("protects audit_logs and append-only tables from UPDATE and DELETE via trigger and per-table privileges", async () => {
    const auditId = "eeeeeeee-1111-4111-8111-111111111111";
    await pg.exec(`
      INSERT INTO audit_logs (id, organization_id, actor_type, action, entity_type, entity_id, retention_until)
      VALUES ('${auditId}', '${ORG_ALPHA}', 'SYSTEM', 'KILL_SWITCH_TEST', 'organization', '${ORG_ALPHA}', NOW() + INTERVAL '365 days');
    `);

    await expect(
      pg.exec(
        `UPDATE audit_logs SET action = 'TAMPERED' WHERE id = '${auditId}';`
      )
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);

    await expect(
      pg.exec(`DELETE FROM audit_logs WHERE id = '${auditId}';`)
    ).rejects.toThrow(/AUDIT_LOG_RETENTION_LOCKED/);

    // Per-table privilege restriction: konnexy_app cannot DELETE from daily_metrics or clients
    await expect(
      pg.exec(`
        BEGIN;
        SET LOCAL ROLE konnexy_app;
        SELECT set_config('app.current_organization_id', '${ORG_ALPHA}', true);
        DELETE FROM clients WHERE id = '${CLIENT_ALPHA}';
        COMMIT;
      `)
    ).rejects.toThrow(/permission denied for table clients/);
    await pg.exec("ROLLBACK;");
  });

  it("executes persistent Drizzle onboarding and tenant-scoped queries with CLIENT_VIEWER filtering", async () => {
    const db = drizzle(pg, { schema });
    const repo = new PersistentDrizzleTenantRepository(db);

    const onboarded = await onboardFirstOrganizationRepository(db, {
      fullName: "Novo Gestor Onboarding",
      email: "onboarding@konnexy.com.br",
      password: "SafeOnboardingPassword#2026",
      organizationName: "Konnexy Nova Agencia",
      organizationSlug: "konnexy-nova-agencia",
      timezone: "America/Sao_Paulo",
      currencyCode: "BRL",
    });

    expect(onboarded.organization.executionMode).toBe("READ_ONLY");
    expect(onboarded.membership.role).toBe("OWNER");

    const ownerCtx: TenantContext = {
      organizationId: onboarded.organization.id,
      organizationSlug: onboarded.organization.slug,
      userId: onboarded.user.id,
      role: "OWNER",
      executionMode: "READ_ONLY",
      emergencyStopActive: false,
    };

    const client1 = await repo.createClient(ownerCtx, {
      name: "Cliente Onboarding 01",
      industry: "Saude",
      monthlyBudgetCapCents: 400_000,
    });
    const client2 = await repo.createClient(ownerCtx, {
      name: "Cliente Onboarding 02",
      industry: "Educacao",
      monthlyBudgetCapCents: 300_000,
    });

    const allClientsForOwner = await repo.listClients(ownerCtx);
    expect(allClientsForOwner).toHaveLength(2);

    // CLIENT_VIEWER assigned ONLY to client1 must not see client2
    const viewerCtx: TenantContext = {
      ...ownerCtx,
      role: "CLIENT_VIEWER",
      allowedClientIds: [client1.id],
    };

    const viewerClients = await repo.listClients(viewerCtx);
    expect(viewerClients).toHaveLength(1);
    expect(viewerClients[0]?.id).toBe(client1.id);
    expect(viewerClients.some((c) => c.id === client2.id)).toBe(false);
  });
});
