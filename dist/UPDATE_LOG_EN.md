# Update Log (EN)

This file is used to document and manage update items prior to every Merge Request (MR). All developers and AI Agents must strictly adhere to the Update Log Management Guidelines when modifying the codebase.

---

## [Branch: 0708_fft_optimize] (Cut from main branch at commit `176e450`)
* **Date**: 2026-07-08
* **Status**: Completed / Pending Merge (Bump version to `v1.3.0_20260708` / `0.2.0`)
* **Changelog Details**:
  * **📈 Controller Wiener Deconvolution System ID & FFT Power Spectrum (PidResponsePanel)**:
    * **Wiener Deconvolution System ID**: Implemented frequency-domain Wiener Deconvolution and step response accumulation integration in `mathUtils.ts`. Allows reconstructing a normalized step response equivalent directly from arbitrary manual stick logs.
    * **Noise Regularization & Mode Switches**: Added toggle between "Time Window" and "Wiener ID" modes, along with an SNR noise regularization slider (1 to 500) to filter out high-frequency noise outside setpoint excitations.
    * **Setpoint & Feedback FFT Comparison**: Added a third uPlot chart displaying offline FFT amplitude spectra of both setpoint and feedback signals, helping diagnose resonance peaks and control loop bandwidth.
  * **⚡ High-Performance Cross-Correlation & Slice Downsampling (Worker & Math)**:
    * **JIT & SIMD Vectorization**: Optimized cross-correlation lag detection (`detectLagUs`) by pre-calculating index boundaries and moving de-trending calculations outside loops, eliminating conditional branches inside the main loop to enable JIT vectorization (10x faster execution).
    * **Intelligent Downsampling**: Automatically downsamples slices exceeding 50,000 points uniformly in the Web Worker (`ulogWorker.ts`), preventing main thread freezing and ensuring smooth uPlot rendering, while restoring 100% resolution during zoom-in.
  * **📊 Dynamic Frequency-Based Sensor Selection & Source Badge (VibrationPanel)**:
    * **Dynamic Rate Sorting**: Refactored `findSensorTopic` to dynamically sort candidates based on actual logging rates (`freqHz`). Prioritizes high-rate raw sensor topics (`sensor_accel`/`sensor_gyro` at 1000Hz+) over medium-rate (`sensor_combined`) and EKF estimates, preventing aliasing folding and ensuring correct Nyquist bandwidth.
    * **Active Source Badge**: Added a badge in the Vibration/FFT panel showing the current active topic name and logging frequency to improve data transparency.
  * **🎯 FFT Zoom Limits Clamping (0 ~ 1.1*Nyquist)**:
    * Restricted X-axis zoom limits on FFT charts between `0` and `1.1 * Nyquist` (`1.1 * frequencies[length - 1]`) in both `VibrationPanel` and `PidResponsePanel`. Smoothly clamps limits without zoom center distortions.
  * **⚙️ UI Title & Render Race Condition Fixes**:
    * Updated `ChartPanel.tsx` with a `switch` mapper for proper localized title header rendering of all toolboxes instead of defaulting to "2D GPS Map".
    * Added a `useEffect` hook in `PidResponsePanel.tsx` to automatically redraw the FFT chart upon data updates, resolving a React mounting race condition where the container was initially absent.

## [Branch: 0707_fix_topic_lost] (Cut from main branch at commit `d04f305`)
* **Date**: 2026-07-07
* **Status**: Completed / Pending Merge
* **Changelog Details**:
  * **⚡ ULog Nested Format Dependency & Parsing Fix (ULogParser)**:
    * **Deferred & Recursive Format Resolution**: Decoupled raw format reading (`_parseFormat`) and structural resolution (`_resolveFormat`). Raw format string declarations are cached during the definition scan, and recursively resolved only after the definition block ends. This fixes a critical bug where a nested structure (e.g., `esc_report` inside `esc_status`) declared *after* its parent structure caused the parent to fallback to a generic `uint8_t[8]` definition, leading to incorrect format size calculation, byte offset misalignment, and complete data corruption.
    * **Circular Dependency Protection**: Introduced a tracking set `resolvingFormats` during recursive resolution to guard against cyclic definitions in corrupted log files, preventing stack overflow errors.
    * **Nested Field Recovery**: Nested array fields like `esc_status.esc[i].esc_rpm` are now fully expanded with correct offsets and data types, enabling successful extraction and rendering of ESC/Motor RPM plots.

## [Branch: 0705_plot_feature] (Cut from main branch at commit `d04f305`)
* **Date**: 2026-07-05
* **Status**: Completed / Pending Merge
* **Changelog Details**:
  * **✈️ Flight Status & Mode Analysis (StatusModePanel)**:
    * **Independent Flight Mode & Arming Chart**: Extracted Flight Mode and Arming State into an independent chart (`Flight Mode & Arming History`), plotting them using stepped lines. Supports double Y axes (left for Arm/Disarmed, right for PX4 mode string labels such as POSCTL, ALTCTL, RTL...), perfectly aligned with stick inputs and failsafe charts.
    * **Multi-Mode Stick Input Tabs**: Loads `manual_control_setpoint`, `rc_channels`, and `input_rc` simultaneously in the background. Added sub-tabs `[Setpoint]`, `[RC Channels]`, and `[Raw RC]` at the top-right corner of the stick input chart for quick user comparison.
    * **Full RC Channels & PWM Plotting**: Switching to the `Raw RC (PWM us)` tab automatically decodes and plots all available channels of `input_rc.values[0..n]`, automatically locking the Y-axis range to `850 ~ 2150 us` to display auxiliary switches and fine-tuning knobs.
    * **Mission Event Log**: Refined the console output on the right to display Mode Transitions and Safety & Failsafe Events clearly.
  * **🧲 Multi-Magnetometer Norm & EKF GSF Heading Comparison (MagneticPanel)**:
    * **Automatic `sensor_mag` Topic Adaptation**: Scans and loads all `vehicle_magnetometer` or `sensor_mag` topic instances (Compass 0, 1, 2...). Adapts to both `magnetometer_ga` and legacy `x`/`y`/`z` field formats, plotting all aligned norms on the same Vector Norm chart.
    * **Raw 3-Axis Magnetic Values Chart**: Added a third chart `Raw 3-Axis Magnetic Values` to the left column plotting raw X, Y, and Z curves in Gauss, complete with a dropdown selector to view different compass instances.
    * **Pure Magnetometer Tilt-Compensated Headings**: Decodes roll and pitch from `vehicle_attitude` to project the 3D magnetic readings of all detected compasses onto the horizontal plane, plotting their independent pure magnetic headings (Yellow, Purple, Cyan curves) on the Heading Comparison chart.
    * **Independent Checkbox Selector**: Added checkboxes in the heading chart header (EKF Yaw, GSF Yaw, GPS COG, Mag 0/1/2 Yaw) to toggle line visibility independently from the raw data compass dropdown.
    * **Comprehensive Compass Diagnostics**: Lists the computed average norm, fluctuation variation, and EMI warnings for all detected compasses in the right-hand board.
  * **📊 Scroll Wheel Zoom & Zoom Sync in Toolbox Panels**:
    * Enabled mouse wheel zoom events (`'wheel'`) on all toolbox charts (FFT, PID, Magnetic, Status/Modes, and Actuator Outputs).
    * Linked multi-chart panels (PID, Magnetic, Status/Modes) with shared `uPlot.sync` instances, synchronizing mouse cursor tracking, horizontal panning, and scroll wheel zooming across all sub-graphs.
  * **⚡ Direct Blank Chart Initialization for New Panels**:
    * Updated [appStore.tsx](file:///home/kenny/Git_KennySpace/HTML_uLog_analyzer/src/store/appStore.tsx) to initialize newly created split panels (`SPLIT_PANEL`) or collapsed resets (`REMOVE_PANEL`) directly as `type: 'chart'` (blank chart). This removes the empty-state selection menu, allowing users to drag fields immediately.

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
  * **🏷️ Global GitHub Link & Version-Changelog Integration (LandingPage & TopBar & Vite)**:
    * Added a GitHub repository icon link and a version build number tag (`v1.1.2_20260704`) to the footer of the file upload section (`LandingPage`) and the header status bar (`TopBar`).
    * Configured the version build tag as a clickable link that opens the language-specific changelog file: `UPDATE_LOG_EN.md` for English interface and `UPDATE_LOG.md` for Chinese interface.
    * Implemented an inline custom Rollup plugin (`copy-update-logs`) in `vite.config.ts` to automatically bundle the changelog markdown files into the `dist/` directory, ensuring offline file links remain fully functional.
