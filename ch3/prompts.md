# Chapter 3 — Architect's Prompts

**Security-First and Compliance-First Architecture**

The Architect's Prompts from Chapter 3, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**4 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [3.1 The Open Door Audit](#prompt-3-1-the-open-door-audit) | Right after exposing or scaling new services, to find every endpoint reachable without… |
| [3.2 The AI Guardrail](#prompt-3-2-the-ai-guardrail) | When you want to stop your team (or an AI coding agent) from repeating a known security… |
| [3.3 The Policy Enforcer](#prompt-3-3-the-policy-enforcer) | When a compliance requirement (GDPR, PII handling, encryption) must be enforced… |
| [3.4 The Identity Conversion](#prompt-3-4-the-identity-conversion) | When migrating a service off hardcoded secrets and environment-variable keys onto workload… |

---

## Prompt 3.1 — The Open Door Audit

**When to use this:** Right after exposing or scaling new services, to find every endpoint reachable without authentication before an attacker does.

```text
Act as a Security Engineer performing a 'White Box' penetration test. Review the following docker-compose.yml and server.js file.
Task:
Identify 'Implicit Trust' Assumptions: Flag any service-to-service communication that relies solely on 'being on the same network' (e.g., connecting to a database without SSL, or accepting HTTP requests from any IP).
Locate the Secrets: Find any environment variables or hardcoded strings that look like API keys or passwords.
Generate an 'Allow List' Policy: Rewrite the network configuration to explicitly deny all ingress traffic by default, and output the specific allow rules needed for the web service to talk to the api service only.
```

## Prompt 3.2 — The AI Guardrail

**When to use this:** When you want to stop your team (or an AI coding agent) from repeating a known security mistake by encoding it as an automated guardrail.

```text
Act as a DevSecOps Engineer. I want to prevent my team from repeating past security mistakes.
Task:
Analyze this list of 'Post-Mortem' summaries from our last 3 security incidents (e.g., 'committed API key', 'open S3 bucket', 'SQL injection in search').
Generate a custom 'Semgrep' rule or a Python script that scans a Pull Request specifically for these patterns.
Create a 'Pre-Commit' hook script that runs this scanner locally before git commit is allowed. The hook should provide a friendly error message explaining why the commit was blocked.
```

## Prompt 3.3 — The Policy Enforcer

**When to use this:** When a compliance requirement (GDPR, PII handling, encryption) must be enforced automatically in CI rather than checked by hand in review.

```text
Act as a Compliance Engineer. I need to enforce GDPR Data Residency rules using Open Policy Agent (OPA).
Task:
Write a Rego policy for Kubernetes that blocks any Deployment if the region label does not match the customer_data_location label. (e.g., German customer data cannot be deployed to a US-East pod).
Create a 'Break Glass' exception rule: Allow the deployment ONLY if the annotation emergency-override: true is present AND the approver field is filled.
Generate a 'Audit Log' JSON structure that would be emitted whenever this policy denies a request, so we can track who tried to break the rules.
```

## Prompt 3.4 — The Identity Conversion

**When to use this:** When migrating a service off hardcoded secrets and environment-variable keys onto workload identity and a managed secrets vault.

```text
Act as a Cloud Security Architect. I am refactoring a legacy Node.js service to use Azure Key Vault instead of .env files.
Task:
Scan the code for any process.env.PASSWORD or process.env.API_KEY patterns.
Generate a refactoring plan that replaces these lines with a SecretClient fetch call using the Azure SDK (or generic Vault equivalent).
Write a Terraform snippet to create a 'Managed Identity' for this app and grant it Get and List permissions on the Key Vault, adhering to the Principle of Least Privilege.
```
