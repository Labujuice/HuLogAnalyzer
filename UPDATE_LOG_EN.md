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
  * **🌐 System-Wide Bilingual Switching (i18n)**:
    * Integrated translation dictionary support across the LandingPage, TopBar, PlayBar, ChartPanel, and Sidebar.
    * Added language selection dropdown menus (supporting English and Traditional Chinese) at the top-right corner of both the TopBar and the LandingPage, defaulting to English.
  * **🛸 3D Camera Limits Removal & Frustum Culling Fix (Attitude3dPanel)**:
    * Expanded 3D camera zoom range (from 1.0m to 2000m) and removed camera pitch boundaries (allowing 0.01 to \u03c0 - 0.01), enabling users to inspect the flight path from any perspective, including directly underneath the drone.
    * Fixed a WebGL frustum culling bug where path lines would disappear at certain camera rotation angles by forcing `computeBoundingSphere` and `computeBoundingBox` recalculation upon line vertex updates.
  * **🗺️ 2D Terrain Relief Layer (MapPanel)**:
    * Introduced a "Terrain" map option (overlaying Google Terrain tiles `lyrs=p`) alongside Satellite and Roadmap, providing hillshading, land reliefs, and contour lines overlay visualization.
  * **🎛️ Resizable Sidebar Layout (Sidebar Resize)**:
    * Added a vertical drag handle in the core layout (`App.tsx` and `App.module.css`) with a hover highlight indicator (cyan neon glow).
    * Enabled users to adjust the sidebar width dynamically between `200px` and `600px` by dragging, resolving the issue where long field names or parameter labels were truncated.
  * **📋 Parameter Explorer Enhancements (Metadata Explorer)**:
    * Added parameter filtering/search and name sorting (A-Z / Z-A) controls inside the Sidebar's Metadata tab, allowing real-time searching by parameter name or value.
    * Integrated a "Show All" / "Show Less" toggle that replaces the static 30-parameter display limit, allowing complete inspection of the full parameter file.
  * **🛰️ 3D Satellite Map Overlay & Real-Time Terrain Plumb Line (Attitude3dPanel)**:
    * Dynamically calculated Web Mercator home offsets and flight radius from GPS caches to asynchronously stitch a $3 \times 3$ grid of Google Satellite tiles (`lyrs=s`) centered at the takeoff location in the 3D viewer.
    * Added a "Satellite Ground" toggle button in the 3D panel's control overlay to allow users to switch backgrounds easily.
    * Introduced a ground track projection line and an interactive vertical plumb line that tracks drone altitude above the terrain. The lines dynamically adjust their heights based on the ULog's `dist_bottom` (ground distance sensor) field, and automatically project onto the flat takeoff plane ($Y = 0$) as a fallback.
  * **🔺 2D Map UAV Triangle Pointer Icon (MapPanel)**:
    * Standardized the 2D map drone icon as a black-bordered, red-filled isosceles triangle pointer following aerospace visualization specifications.
    * Corrected HTML layout bindings and CSS class name references for both the arrow and radar pulse effects, guaranteeing the icon maintains constant physical pixel dimensions (no scaling/distortions) during map zooming.
  * **🏷️ 3D Body Frame FRD Axis Indicators (Attitude3dPanel)**:
    * Programmed aviation-standard FRD (Forward-Right-Down) coordinate axes at the drone center.
    * Assigned Red for Forward (local -Z axis), Green for Right (local +X axis), and Blue/Cyan for Down (local -Y axis).
    * Created 2D Canvas-rendered 3D text sprites (F, R, D) with disabled depth testing placed at the tips of the arrows. They face the screen at all times to provide orientation readouts.
  * **🛸 3D Multi-Vehicle Model Selector & Animations (Attitude3dPanel)**:
    * Added a model selector dropdown menu to the 3D control overlay, allowing users to toggle between six recognizable vehicle meshes:
      1. `X-type multirotor`: Features a compact central hub (16cm x 6cm x 16cm), two BoxGeometries crossed at 90 degrees to form the arm frame, a red nose cone, and four propellers. The propeller spin rate is dynamically scaled in real-time by interpolating the average of motor speed outputs (`actuator_outputs` or `actuator_motors`) in the log, simulating high-speed rotation during takeoff and slower rotation during hover or landing.
      2. `Fixwing`: Features a detailed airplane body, red-tipped wings, tail fins, and a spinning front propeller blade.
      3. `car`: Features an orange rover chassis, cabin glass, black bumpers, and four rolling rubber wheels.
      4. `turtle`: Features a squashed turtle shell, green head, tiny tail, and four flippers that wiggle in a swimming motion.
      5. `eagle`: Features a brown body, white head, yellow beak, and wing assemblies that dynamically flap up and down.
      6. `kabibala`: Features a cute capybara cylinder body, boxy face, small ears, black eyes/snout, and four legs that jog back and forth.
    * Utilized `modelTypeRef`, `isPlayingRef`, and `speedMultiplierRef` to bypass React stale closure snapshots, fixing the issue where propellers remained static during playback.
    * Added a `sceneReady` state synchronization check inside the model builder `useEffect` dependencies, correcting the rendering issue where the drone model sometimes failed to render or disappeared on initial 3D panel mount.
  * **📄 Open Source License Declaration (LICENSE)**:
    * Created the MIT license declaration file [LICENSE](./LICENSE) in the workspace root directory.
  * **🎨 Drag-and-Drop Area Styling Restoration (LandingPage)**:
    * Corrected a camelCase spelling typo for the dropzone container class in the landing page component (`dropzone` -> `dropZone`, `dropzoneActive` -> `dragOver`), successfully restoring the dashed border, glassmorphism glow effect, and hover scale transition properties for the drag-and-drop file upload target.
