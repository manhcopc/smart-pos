# Smart-POS

Nền tảng **SaaS POS Bán hàng & Quản lý kho đa chi nhánh** cho nhiều chủ cửa hàng đăng ký.

## Kiến trúc Monorepo (Mô hình 2)

```text
smart-pos/
├── .agents/skills/          # Bộ Agent Skills chuyên biệt cho NestJS, Next.js, Postgres, Redis, Multi-tenant
├── apps/
│   ├── api/                 # NestJS REST API, WebSockets/SSE, BullMQ Workers, Prisma
│   └── web/                 # Next.js App Router (POS Terminal + Management Dashboard + Offline IndexedDB)
├── packages/
│   └── shared/              # Zod schemas, shared types, RBAC permission constants
├── docs/
│   ├── SRS.md               # Đặc tả yêu cầu phần mềm (tổng hợp 5 nguồn SRS chuẩn + GitHub POS patterns)
│   ├── DATABASE_SCHEMA.md   # Thiết kế PostgreSQL Multi-tenant & Inventory Ledger
│   └── ROADMAP.md           # Lộ trình triển khai theo từng Phase
├── docker-compose.yml       # PostgreSQL 16 + Redis 7 cho môi trường dev
├── pnpm-workspace.yaml
└── turbo.json
```

## Khởi chạy hạ tầng dev (PostgreSQL + Redis)

```bash
cp .env.example .env
docker compose up -d
```

Xem chi tiết tài liệu:
- [docs/SRS.md](./docs/SRS.md)
- [docs/DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
