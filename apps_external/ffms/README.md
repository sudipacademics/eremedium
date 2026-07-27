# Remedium Lab Franchise Management System (RFMS)

RFMS is a modular platform for franchise marketing, applicant onboarding, compliance, territory allocation, payments and operations. The initial delivery establishes the monorepo, three Next.js application shells, a Laravel API foundation, shared design tokens, Docker services, and the working Admin Operations Console.

## Quick local preview (Windows)

Double-click `setup-local.cmd` once, then double-click `start-local.cmd`. It opens the Admin Dashboard at `http://localhost:3002`; the Marketing Website and Applicant Portal are also available on ports 3000 and 3001. See `LOCALHOST-GUIDE.md` for the full manual test guide.

## Backend local development

Copy `.env.example` to `.env` and set local secrets. The supplied Docker configuration reserves MySQL, Redis and the PHP 8.3 API environment for the Laravel API milestone. The host PHP runtime is 8.0, below Laravel 12's PHP 8.2 requirement, so Docker is the supported API runtime when that milestone is implemented.

## Structure

`apps/` contains the three Next.js frontends and Laravel API. `packages/` contains shared UI tokens, types, validation, utilities and API client contracts. `documentation/` holds the delivery architecture and governance records.
