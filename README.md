# Smart-POS

Nền tảng **SaaS POS Bán hàng & Quản lý kho đa chi nhánh** cho nhiều chủ cửa hàng đăng ký.

## Kiến trúc Monorepo (Mô hình 2)

```text
smart-pos/
├── .agents/skills/          # Bộ Agent Skills chuyên biệt cho NestJS, Next.js, Postgres, Redis, GitHub
├── .github/workflows/       # CI pipeline (build, typecheck, lint, test, prisma validate)
├── apps/
│   ├── api/                 # NestJS REST API, Swagger, Redis, BullMQ, Prisma + PostgreSQL RLS
│   └── web/                 # Next.js App Router (POS Terminal + Management Dashboard + shadcn/ui)
├── packages/
│   └── shared/              # Zod schemas, fixed-point money math, error codes, RBAC permission matrix
├── docs/
│   ├── SRS.md               # Đặc tả yêu cầu phần mềm (Priority 1–3 + NFR)
│   ├── DATABASE_SCHEMA.md   # Thiết kế PostgreSQL Multi-tenant & Inventory Ledger
│   └── ROADMAP.md           # Lộ trình triển khai theo từng Phase
├── docker-compose.yml       # PostgreSQL 16 + Redis 7 cho môi trường dev
├── pnpm-workspace.yaml
└── turbo.json
```

## Cài đặt & Khởi chạy Dev

1. Tạo file môi trường và cài đặt dependencies:

```bash
cp .env.example .env
pnpm install
```

2. Bật hạ tầng PostgreSQL 16 + Redis 7, chạy migration (bao gồm PostgreSQL RLS) và seed gói SaaS:

```bash
pnpm db:up
pnpm --filter @smart-pos/api prisma:migrate:deploy
pnpm --filter @smart-pos/api prisma:seed
```

3. Chạy toàn bộ hệ thống ở chế độ dev (`api` tại `:4000`, Swagger tại `/api/docs`, `web` tại `:3000`):

```bash
pnpm dev
```

## Kiểm tra chất lượng code

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

## Tài liệu chi tiết
- [docs/SRS.md](./docs/SRS.md)
- [docs/DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
