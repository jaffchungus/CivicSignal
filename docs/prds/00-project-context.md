# CivicSignal Project Context

Status: Requirements baseline incomplete  
Evidence date: 2026-09-21  
Repository revision inspected: `64b9ae3` (`Initial commit`)

## Purpose

This document records the current, evidence-based state of CivicSignal and defines what can and cannot be specified without inventing product requirements.

## Sources inspected

- The complete local working tree and Git history.
- The `main` branch and all remote branch references.
- The authenticated GitHub repository metadata, contents, issues, and pull requests.
- The task instructions that requested this PRD suite.

The repository currently contains only `.gitattributes`, which enables Git text-file normalization. The Git history contains one commit. The private GitHub repository has no description, homepage, topics, wiki, issues, pull requests, or branches other than `main`.

The task instructions describe how to produce specifications; they do not describe CivicSignal's product concept, users, workflows, features, constraints, or intended operating environment.

## Current implementation state

The repository has been initialized, but no application system has been implemented.

| Area | Current state | Evidence |
|---|---|---|
| Product behavior | Not defined | No product documentation or issues |
| Technology stack | Not selected | No manifests, source files, or architecture records |
| Architecture | Not defined | No application components or ADRs |
| Frontend | Not implemented | No frontend source or build configuration |
| Backend | Not implemented | No backend source or build configuration |
| Database | Not selected or implemented | No schema, migrations, or database configuration |
| Authentication | Not defined or implemented | No requirements or code |
| Authorization | Not defined or implemented | No roles, permissions, requirements, or code |
| APIs | Not defined or implemented | No contracts, routes, schemas, or code |
| Testing | Not configured | No test runner, tests, or CI workflow |
| Deployment | Not configured | No infrastructure or deployment files |
| Observability | Not defined | No requirements or configuration |

## Existing conventions and decisions

Only the following repository convention is established:

- Git should automatically detect text files and normalize them to LF on commit, as configured in `.gitattributes`.

No naming, language, framework, module-boundary, data-model, API, testing, security, privacy, or deployment conventions are established.

## Requirements available for specification

There are no product requirements from which implementation-ready functional PRDs can be derived. In particular, the available sources do not determine:

- the problem CivicSignal solves;
- the intended users or user roles;
- the meaning of “CivicSignal” within this project;
- the MVP workflows or success criteria;
- whether the product is a web application, mobile application, service, library, or another form;
- the information the system stores or processes;
- whether accounts, personal data, location data, uploads, notifications, or external integrations are required;
- legal, regulatory, accessibility, performance, availability, retention, or regional constraints;
- the expected deployment environment or operational scale.

The repository name is not sufficient evidence for any of these decisions. Inferring a civic-engagement, government, reporting, alerting, or communications product from the name alone would violate the instruction not to invent the product concept or major features.

## Planned but not implemented

No product work is documented as planned. The only explicit planned work is the creation of a repository-grounded PRD suite. Because the product baseline is absent, substantive feature PRDs cannot yet be made concrete, testable, and implementation-ready.

## Specification boundary

This PRD set therefore does the following:

1. Records the verified repository state.
2. Records which architecture and product decisions remain unresolved.
3. Defines the minimum evidence required before substantive PRDs can be authored.
4. Avoids selecting a stack, architecture, data model, permission model, API, or feature set without source requirements.

This PRD set does not authorize application implementation. Any implementation based only on the repository name would be speculative.

## Required product baseline

Before feature PRDs can be created, the project source of truth must establish at least:

1. Product problem and intended outcome.
2. Target users and any distinct roles.
3. MVP user journeys and their priority.
4. Information created, consumed, shared, imported, or exported.
5. Trust, safety, privacy, and regulatory constraints applicable to that information.
6. Required platforms and external integrations.
7. Operational constraints, including expected scale and deployment assumptions where known.
8. Observable acceptance criteria for the MVP.

Once that baseline exists in the repository or issue tracker, `01-architecture.md`, `DECISIONS.md`, and the functional PRD set must be revised together.

