# Security Policy

## Supported Scope

Slipstream is an open-source F1 analytics platform. Security reports are especially helpful for issues involving:

- authentication or authorization bypasses
- remote code execution
- dependency or supply-chain risks
- secret exposure
- unsafe defaults in deployment or configuration
- data access issues that could expose user or infrastructure data

## Reporting a Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Instead, report security issues privately to:

- `abdullahazeemi.work@gmail.com`

When possible, include:

- a description of the issue
- reproduction steps
- affected files, routes, or services
- impact assessment
- any suggested mitigation

## Response Expectations

We will aim to:

- acknowledge receipt within 72 hours
- confirm whether the issue is valid
- work on a fix or mitigation as quickly as practical
- coordinate responsible disclosure once a fix is available

## Secrets and Local Setup

Please never commit:

- `.env` files
- credentials
- private API tokens
- database dumps containing sensitive data

Use `.env.example` as the template for local configuration.
