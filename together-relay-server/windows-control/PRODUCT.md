# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron desktop application using Node.js and a dependency-free HTML/CSS/JavaScript renderer. It packages the existing relay runtime without changing its client protocol.

## Users

Windows server administrators who deploy and operate one Mineradio Together Listen relay instance for two listeners.

## Product Purpose

Provide a graphical, local-only control surface for configuring, starting, stopping, observing and diagnosing the existing Mineradio relay service without requiring command-line operations.

## Operating Context

The application runs in the Windows notification area, manages a local relay child process, and can start after Windows login. Administrators share the configured domain or IP and six-digit authorization code with two listeners.

## Capabilities and Constraints

- Preserve the existing TCP, HTTP status and WebSocket protocols.
- Store the authorization code with Windows DPAPI through Electron safeStorage.
- Show process health, listener count, endpoint and runtime logs.
- Support start, stop, restart, configuration validation and diagnostic export.
- One application instance manages one relay process with a maximum of two listeners.
- Auto-start means after Windows user login, not a pre-login Windows Service.

## Brand Commitments

Product name: Mineradio 一起听中转控制台. Developer signature: JIAFEE. The interface extends the existing Together Listen dark glass material and mint/ice status colors.

## Product Principles

- Protocol compatibility is non-negotiable.
- Risky actions are explicit and reversible.
- Secrets remain local and are never written to logs or diagnostics.
- Health and failure states must be understandable without reading raw logs.

