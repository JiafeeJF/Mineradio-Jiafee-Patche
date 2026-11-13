# Design System

## Direction

An operational extension of Mineradio Together Listen: smoked black glass, restrained mint status color, ice-blue secondary actions, fine separators and compact Chinese typography. The interface behaves like a Windows administration tool rather than a landing page.

## Tokens

- Canvas: `#090b0e`; raised surface: `rgba(21, 24, 29, .84)`.
- Primary text: `#f2f6f7`; secondary: `rgba(226, 235, 238, .62)`.
- Healthy: `#72e0bd`; pending: `#e7bd72`; error: `#ff8b96`; informational: `#8fc4dc`.
- Radius: 6px controls, 10px grouped surfaces, 14px application shell.
- Font: Segoe UI / Microsoft YaHei UI. Monospace is reserved for endpoints, ports and logs.

## Interaction

- Primary service controls remain visible in every view.
- Configuration changes are validated before persistence and clearly indicate when a restart is required.
- Motion is limited to status transitions, the live connection signal and view changes; reduced-motion settings disable it.
- Focus rings and state labels do not rely on color alone.

