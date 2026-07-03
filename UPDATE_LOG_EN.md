# Update Log (EN)

This file is used to document and manage update items prior to every Merge Request (MR). All developers and AI Agents must strictly adhere to the Update Log Management Guidelines when modifying the codebase.

---

## [Branch: 0704_optimize] (Cut from main branch at commit `2022367`)
* **Date**: 2026-07-04
* **Status**: In Development / Pending Merge
* **Changelog Details**:
  * **✈️ AHRS PFD HUD Instrument Upgrade (AhrsPanel)**:
    * Added scrolling Heading Compass Tape at the top, complete with dynamic degree readouts and cardinal point indicators (N, E, S, W in red).
    * Added vertical scrolling Airspeed/Groundspeed Tape on the left, dynamically synthesizing and interpolating `vx` and `vy`.
    * Added vertical scrolling Altitude Tape on the right, syncing with local height `-z`.
    * Added vertical Rate of Climb Indicator (VSI / Vario) scale next to the altitude tape, tracking climb/descend speed ($\pm 5\text{ m/s}$).
  * **🗺️ Map View Autocentering & fitBounds (MapPanel)**:
    * Implemented a single-trigger automatic `fitBounds` trajectory framing that zooms to fit the entire path as soon as the GPS topic cache resolves. This prevents interfering with subsequent manual user zoom adjustments.
  * **🛸 3D Trajectory Viewer Controls (Attitude3dPanel)**:
    * Enabled camera panning via middle-mouse dragging (button 1), adapting pan sensitivity dynamically to the camera zoom radius.
    * Added a floating glassmorphic "📍 Resume Follow" button that smoothly snaps camera focus back onto the drone after panning away.
  * **⚙️ Development Environment Standardization (package.json & README.md)**:
    * Added a unified script to run both Dev and Preview servers concurrently in the background: `npm run serve:all`.
    * Added a cleanup script to terminate servers and free ports: `npm stop`.
  * **🛠️ Pathing Specifications (Relative Path Rule)**:
    * Created `.agents/AGENTS.md` and added "Relative Paths Rule" in the development guidelines and AI Agent execution protocols to enforce relative pathing globally, guaranteeing double-click offline execution.
