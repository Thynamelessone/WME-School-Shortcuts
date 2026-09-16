// ==UserScript==
// @name        WME School Shortcuts
// @namespace   https://github.com/
// @version     1.1.0-beta.9
// @description Keyboard shortcuts for creating School Area Places and School Zones in WME.
// @author      Thynamelessone
// @match       https://www.waze.com/*editor*
// @match       https://beta.waze.com/*editor*
// @exclude     https://www.waze.com/*user/*editor/*
// @grant       none
// @require     https://cdn.jsdelivr.net/gh/TheEditorX/wme-sdk-plus@72968ef0792a3bd673f768f8ee2a10d67653d1ea/wme-sdk-plus.js
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @downloadURL https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// @updateURL   https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// ==/UserScript==

(function () {
    "use strict";
    const SCRIPT_ID = "WME-School-Shortcuts";
    const SCRIPT_NAME = "WME School Shortcuts";
    const updateMessage = "New Feature: Convert Area Places to School Zones and vice versa";
    WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, GM_info.script.version, updateMessage);

    const SHORTCUT_GROUP_ID = `${SCRIPT_ID}-shortcuts`;

    const SHORTCUT_IDS = {
        schoolPlace: `${SCRIPT_ID}-create-school-place`,
        schoolZone: `${SCRIPT_ID}-create-school-zone`,
    };

    const DEFAULT_SHORTCUTS = {
        schoolPlace: "CS+S",
        schoolZone: "AS+S",
    };

    const CONVERT_BUTTON_IDS = {
        toSchoolZone: `${SCRIPT_ID}-convert-to-zone`,
    };

    let sdk = null;
    let observer = null;

    // Helper to safely resolve legacy Waze / W globals from window
    function getWmeGlobals() {
        const W = typeof window !== "undefined" ? window.W : undefined;
        const Waze = typeof window !== "undefined" ? (window.Waze || W) : W;
        return { W, Waze };
    }

    /*
     * ---------------------------------------------------------
     * Helpers & Geometry Sanitizer
     * ---------------------------------------------------------
     */

    function isDrawCancelled(error) {
        if (!error) return false;
        const message = String(error?.message || error).toLowerCase();
        return (
            message.includes("draw has been cancelled") ||
            message.includes("draw was cancelled") ||
            message.includes("drawing cancelled")
        );
    }

    function selectVenue(venueId) {
        if (venueId == null) return;
        try {
            sdk.Editing.setSelection({
                selection: { ids: [String(venueId)], objectType: "venue" },
            });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to select School Area Place.`, error);
        }
    }

    function selectPermanentHazard(hazardId) {
        if (hazardId == null) return;
        try {
            sdk.Editing.setSelection({
                selection: { ids: [Number(hazardId)], objectType: "permanentHazard" },
            });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to select School Zone.`, error);
        }
    }

    function cancelActiveDrawing() {
        try {
            if (!sdk?.Editing?.isDrawingInProgress()) return;
            const { W } = getWmeGlobals();
            if (W && W.map && Array.isArray(W.map.controls)) {
                W.map.controls.forEach((control) => {
                    if (control?.handler && control.handler.active && typeof control.deactivate === "function") {
                        control.deactivate();
                    }
                });
            }
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] Could not cancel active drawing.`, error);
        }
    }

    function extractGeometry(feature) {
        if (!feature) return null;
        if (typeof feature.getGeometry === "function") {
            try {
                const g = feature.getGeometry();
                if (g) return g;
            } catch (e) {}
        }
        return feature.geometry || feature.attributes?.geometry || feature.geom || null;
    }

    function extractNumericVertices(rawGeometry) {
        if (!rawGeometry) return [];
        let points = [];

        const geomObj = rawGeometry.type === "Feature" ? rawGeometry.geometry : rawGeometry;

        // 1. Try getVertices() method
        if (typeof geomObj.getVertices === "function") {
            try {
                const vertices = geomObj.getVertices();
                if (Array.isArray(vertices)) {
                    points = vertices.map((v) => ({
                        x: Number(v.x),
                        y: Number(v.y),
                        z: (v.z !== undefined && !isNaN(Number(v.z))) ? Number(v.z) : 0,
                    }));
                }
            } catch (e) {}
        }

        // 2. Try components array (OpenLayers Polygon -> LinearRing -> Points)
        if (!points.length) {
            const components = geomObj.components || geomObj.attributes?.components;
            if (Array.isArray(components) && components.length > 0) {
                const ring = components[0];
                const ringPts = ring?.components || ring?.attributes?.components;
                if (Array.isArray(ringPts)) {
                    points = ringPts.map((pt) => {
                        const x = Number(pt.x ?? pt.attributes?.x);
                        const y = Number(pt.y ?? pt.attributes?.y);
                        const rawZ = pt.z ?? pt.attributes?.z;
                        const z = (rawZ !== undefined && !isNaN(Number(rawZ))) ? Number(rawZ) : 0;
                        return { x, y, z };
                    });
                }
            }
        }

        // 3. GeoJSON format fallback
        if (!points.length && geomObj.type === "Polygon" && Array.isArray(geomObj.coordinates)) {
            const ring = geomObj.coordinates[0];
            if (Array.isArray(ring)) {
                points = ring.map((coord) => ({
                    x: Number(coord[0]),
                    y: Number(coord[1]),
                    z: (coord[2] !== undefined && !isNaN(Number(coord[2]))) ? Number(coord[2]) : 0,
                }));
            }
        }

        // Filter out invalid numbers for x & y
        points = points.filter((p) => !isNaN(p.x) && !isNaN(p.y));

        if (points.length < 3) return [];

        // Ensure all z properties are numeric (0 instead of NaN or undefined)
        points = points.map((p) => ({
            x: p.x,
            y: p.y,
            z: isNaN(p.z) ? 0 : p.z,
        }));

        // Ensure closed ring
        const first = points[0];
        const last = points[points.length - 1];
        if (first.x !== last.x || first.y !== last.y) {
            points.push({ x: first.x, y: first.y, z: first.z });
        }

        return points;
    }

    function createGeoJSONPolygon(pts, includeZ = false) {
        const coords = pts.map((p) => (includeZ ? [p.x, p.y, p.z] : [p.x, p.y]));
        return {
            type: "Polygon",
            coordinates: [coords],
        };
    }

    function cleanOpenLayersObject(obj, visited = new WeakSet()) {
        if (!obj || typeof obj !== "object") return obj;
        if (visited.has(obj)) return obj;
        visited.add(obj);

        try { delete obj.parent; } catch (e) { obj.parent = null; }
        try { delete obj.bounds; } catch (e) { obj.bounds = null; }
        try { delete obj.layer; } catch (e) { obj.layer = null; }
        try { delete obj.feature; } catch (e) { obj.feature = null; }

        if (Array.isArray(obj.components)) {
            for (const child of obj.components) {
                cleanOpenLayersObject(child, visited);
            }
        }
        return obj;
    }

    async function addSchoolVenue(rawGeometry) {
        const pts = extractNumericVertices(rawGeometry);
        if (!pts || pts.length < 3) {
            throw new Error("Invalid or empty polygon geometry.");
        }

        const geo2d = createGeoJSONPolygon(pts, false);
        const geo3d = createGeoJSONPolygon(pts, true);

        // 1. Try SDK DataModel with clean GeoJSON objects
        if (typeof sdk?.DataModel?.Venues?.addVenue === "function") {
            const sdkOptions = [
                { category: "SCHOOL", geometry: geo2d },
                { category: "SCHOOL", geometry: geo3d },
                { categories: ["SCHOOL"], geometry: geo2d },
                { categories: ["SCHOOL"], geometry: geo3d },
            ];

            for (const opts of sdkOptions) {
                try {
                    const venueId = sdk.DataModel.Venues.addVenue(opts);
                    if (venueId) return venueId;
                } catch (err) {
                    console.warn(`[${SCRIPT_NAME}] SDK addVenue attempt failed:`, err);
                }
            }
        }

        // 2. Internal WME Action Fallback (Uses OpenLayers objects)
        const { W, Waze } = getWmeGlobals();
        const req = typeof require === "function" ? require : window.require;

        if (W && W.model?.actionManager) {
            let AddVenueAction = Waze?.Action?.AddVenue || W?.Action?.AddVenue;
            let VenueFeature = Waze?.Feature?.Vector?.Venue || W?.Feature?.Vector?.Venue;

            if (!AddVenueAction && typeof req === "function") {
                try { AddVenueAction = req("Waze/Action/AddVenue"); } catch (e) {}
            }
            if (!VenueFeature && typeof req === "function") {
                try { VenueFeature = req("Waze/Feature/Vector/Venue"); } catch (e) {}
            }

            if (AddVenueAction && VenueFeature) {
                let olPolygon = null;
                if (typeof OpenLayers !== "undefined" && OpenLayers.Geometry?.Point && OpenLayers.Geometry?.LinearRing && OpenLayers.Geometry?.Polygon) {
                    const olPoints = pts.map((p) => {
                        const pt = new OpenLayers.Geometry.Point(p.x, p.y, p.z);
                        pt.z = p.z;
                        return pt;
                    });
                    const ring = new OpenLayers.Geometry.LinearRing(olPoints);
                    olPolygon = new OpenLayers.Geometry.Polygon([ring]);
                    cleanOpenLayersObject(olPolygon);
                }

                const venue = new VenueFeature({
                    categories: ["SCHOOL"],
                    geometry: olPolygon || rawGeometry,
                });
                const action = new AddVenueAction(venue);
                W.model.actionManager.add(action);
                return venue.id || venue.venueId || venue.attributes?.id;
            }
        }

        throw new Error("Failed to add a new School Area Place.");
    }

    async function addSchoolZone(rawGeometry) {
        const pts = extractNumericVertices(rawGeometry);
        if (!pts || pts.length < 3) {
            throw new Error("Invalid or empty polygon geometry.");
        }

        const geo2d = createGeoJSONPolygon(pts, false);
        const geo3d = createGeoJSONPolygon(pts, true);

        // 1. Try SDK PermanentHazards with clean GeoJSON objects
        if (typeof sdk?.DataModel?.PermanentHazards?.addSchoolZone === "function") {
            for (const geom of [geo2d, geo3d]) {
                try {
                    const zoneId = await sdk.DataModel.PermanentHazards.addSchoolZone({ geometry: geom });
                    if (zoneId) return zoneId;
                } catch (err) {
                    console.warn(`[${SCRIPT_NAME}] SDK addSchoolZone attempt failed:`, err);
                }
            }
        }

        // 2. Internal WME Action Fallback (Uses OpenLayers objects)
        const { W, Waze } = getWmeGlobals();
        const req = typeof require === "function" ? require : window.require;

        if (W && W.model?.actionManager) {
            let AddHazardAction = Waze?.Action?.AddPermanentHazard || W?.Action?.AddPermanentHazard;
            let HazardFeature = Waze?.Feature?.Vector?.PermanentHazard || W?.Feature?.Vector?.PermanentHazard;

            if (!AddHazardAction && typeof req === "function") {
                try { AddHazardAction = req("Waze/Action/AddPermanentHazard"); } catch (e) {}
            }
            if (!HazardFeature && typeof req === "function") {
                try { HazardFeature = req("Waze/Feature/Vector/PermanentHazard"); } catch (e) {}
            }

            if (AddHazardAction && HazardFeature) {
                let olPolygon = null;
                if (typeof OpenLayers !== "undefined" && OpenLayers.Geometry?.Point && OpenLayers.Geometry?.LinearRing && OpenLayers.Geometry?.Polygon) {
                    const olPoints = pts.map((p) => {
                        const pt = new OpenLayers.Geometry.Point(p.x, p.y, p.z);
                        pt.z = p.z;
                        return pt;
                    });
                    const ring = new OpenLayers.Geometry.LinearRing(olPoints);
                    olPolygon = new OpenLayers.Geometry.Polygon([ring]);
                    cleanOpenLayersObject(olPolygon);
                }

                const hazard = new HazardFeature({
                    type: "SCHOOL_ZONE",
                    geometry: olPolygon || rawGeometry,
                });
                const action = new AddHazardAction(hazard);
                W.model.actionManager.add(action);
                return hazard.id || hazard.permanentHazardId || hazard.attributes?.id;
            }
        }

        throw new Error("Failed to add a new School Zone.");
    }

    /*
     * ---------------------------------------------------------
     * Selection readers
     * ---------------------------------------------------------
     */

    function getCurrentSelection() {
        try {
            return sdk?.Editing?.getSelection?.() || null;
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] getSelection() failed.`, error);
            return null;
        }
    }

    function getSelectedSchoolVenue() {
        const selection = getCurrentSelection();
        if (!selection || selection.objectType !== "venue" || !selection.ids?.length) {
            return null;
        }

        const venueId = selection.ids[0];

        try {
            const venue = sdk.DataModel.Venues.getById({ venueId: String(venueId) });
            if (!venue) return null;

            const categories = venue.categories || (venue.category ? [venue.category] : []);
            if (!categories.includes("SCHOOL")) return null;

            return venue;
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to read selected venue.`, error);
            return null;
        }
    }

    /*
     * ---------------------------------------------------------
     * Deletion helpers
     * ---------------------------------------------------------
     */

    async function deleteVenueById(venueId) {
        if (typeof sdk?.DataModel?.Venues?.deleteVenue === "function") {
            try {
                await sdk.DataModel.Venues.deleteVenue({ venueId: String(venueId) });
                return true;
            } catch (e) {}
        }
        if (typeof sdk?.Editing?.deleteFeature === "function") {
            try {
                await sdk.Editing.deleteFeature({ id: String(venueId), objectType: "venue" });
                return true;
            } catch (e) {}
        }
        return false;
    }

    /*
     * ---------------------------------------------------------
     * Conversions
     * ---------------------------------------------------------
     */

    async function convertVenueToSchoolZone(venue) {
        const rawGeometry = extractGeometry(venue);
        if (!rawGeometry) {
            alert(`${SCRIPT_NAME}\n\nCould not read the geometry of the selected School Area Place.`);
            return;
        }

        const venueId = venue.id ?? venue.venueId;

        try {
            const schoolZoneId = await addSchoolZone(rawGeometry);

            await deleteVenueById(venueId);

            console.log(`[${SCRIPT_NAME}] Converted School Area Place ${venueId} -> School Zone ${schoolZoneId}.`);

            setTimeout(() => selectPermanentHazard(schoolZoneId), 100);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to convert School Area Place to School Zone.`, error);
            alert(
                `${SCRIPT_NAME}\n\nFailed to convert to School Zone:\n\n${error?.message || error}\n\n` +
                    `If a new School Zone was created, the original School Area Place may still exist ` +
                    `and will need to be deleted manually.`
            );
        }
    }

    /*
     * ---------------------------------------------------------
     * Create (draw) functions
     * ---------------------------------------------------------
     */

    async function createSchoolZone() {
        if (!sdk) return console.error(`[${SCRIPT_NAME}] SDK is not available.`);

        try {
            cancelActiveDrawing();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const geometry = await sdk.Map.drawPolygon();
            if (!geometry) return;

            const schoolZoneId = await addSchoolZone(geometry);
            console.log(`[${SCRIPT_NAME}] School Zone created:`, schoolZoneId);

            setTimeout(() => selectPermanentHazard(schoolZoneId), 100);
        } catch (error) {
            if (isDrawCancelled(error)) return;
            console.error(`[${SCRIPT_NAME}] Failed to create School Zone.`, error);
            alert(`${SCRIPT_NAME}\n\nFailed to create School Zone:\n\n${error?.message || error}`);
        }
    }

    async function createSchoolAreaPlace() {
        if (!sdk) return console.error(`[${SCRIPT_NAME}] SDK is not available.`);

        try {
            cancelActiveDrawing();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const geometry = await sdk.Map.drawPolygon();
            if (!geometry) return;

            const venueId = await addSchoolVenue(geometry);
            console.log(`[${SCRIPT_NAME}] School Area Place created:`, venueId);

            setTimeout(() => selectVenue(venueId), 100);
        } catch (error) {
            if (isDrawCancelled(error)) return;
            console.error(`[${SCRIPT_NAME}] Failed to create School Area Place.`, error);
            alert(`${SCRIPT_NAME}\n\nFailed to create School Area Place:\n\n${error?.message || error}`);
        }
    }

    /*
     * ---------------------------------------------------------
     * Shortcut registration
     * ---------------------------------------------------------
     */

    function registerShortcutGroup() {
        if (!sdk?.Shortcuts?.addShortcutGroup) {
            console.error(`[${SCRIPT_NAME}] addShortcutGroup() is unavailable.`);
            return false;
        }

        try {
            sdk.Shortcuts.addShortcutGroup({ groupId: SHORTCUT_GROUP_ID, groupName: SCRIPT_NAME });
            return true;
        } catch (error) {
            return true;
        }
    }

    function registerShortcut({ shortcutId, description, shortcutKeys, callback }) {
        try {
            if (sdk.Shortcuts.isShortcutRegistered({ shortcutId })) {
                sdk.Shortcuts.deleteShortcut({ shortcutId });
            }

            try {
                sdk.Shortcuts.createShortcut({ callback, description, shortcutId, shortcutKeys });
                return true;
            } catch (error) {
                console.warn(`[${SCRIPT_NAME}] Could not register ${description} with ${shortcutKeys}.`, error);
                sdk.Shortcuts.createShortcut({ callback, description, shortcutId, shortcutKeys: null });
                return true;
            }
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to register ${description}.`, error);
            return false;
        }
    }

    function registerKeyboardShortcuts() {
        const schoolPlace = registerShortcut({
            shortcutId: SHORTCUT_IDS.schoolPlace,
            description: "Create School Area Place",
            shortcutKeys: DEFAULT_SHORTCUTS.schoolPlace,
            callback: createSchoolAreaPlace,
        });

        const schoolZone = registerShortcut({
            shortcutId: SHORTCUT_IDS.schoolZone,
            description: "Create School Zone",
            shortcutKeys: DEFAULT_SHORTCUTS.schoolZone,
            callback: createSchoolZone,
        });

        return { schoolZone, schoolPlace };
    }

    /*
     * ---------------------------------------------------------
     * Feature editor button injection
     * ---------------------------------------------------------
     */

    function makeConvertButton({ id, label, onClick }) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const btn = document.createElement("button");
        btn.id = id;
        btn.type = "button";
        btn.textContent = label;
        btn.className = "waze-btn waze-btn-white";
        btn.style.cssText = "margin: 8px 0; width: 100%; display: block;";

        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Converting…";
            try {
                await onClick();
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });

        return btn;
    }

    function findVenuePanel() {
        return (
            document.querySelector("#venue-edit-general") ||
            document.querySelector(".venue-edit-general") ||
            document.querySelector("wz-panel[data-testid='venue-feature-editor'] .feature-editor-panel-content")
        );
    }

    function injectVenueConvertButton() {
        const venue = getSelectedSchoolVenue();
        const existing = document.getElementById(CONVERT_BUTTON_IDS.toSchoolZone);

        if (!venue) {
            if (existing) {
                existing.remove();
                return true;
            }
            return false;
        }

        const venueId = String(venue.id ?? venue.venueId ?? "");
        const panel = findVenuePanel();
        if (!panel) return false;

        if (existing && existing.dataset.featureId === venueId && existing.parentElement === panel) {
            return false;
        }

        if (existing) existing.remove();

        const button = makeConvertButton({
            id: CONVERT_BUTTON_IDS.toSchoolZone,
            label: "Convert to School Zone",
            onClick: () => convertVenueToSchoolZone(venue),
        });
        button.dataset.featureId = venueId;

        panel.insertBefore(button, panel.firstChild);
        return true;
    }

    function refreshConvertButtons() {
        observer?.disconnect();

        try {
            injectVenueConvertButton();
        } finally {
            const sidebar = document.getElementById("sidebar") || document.body;
            observer?.observe(sidebar, { childList: true, subtree: true });
        }
    }

    let refreshScheduled = false;

    function scheduleRefresh() {
        if (refreshScheduled) return;
        refreshScheduled = true;
        setTimeout(() => {
            refreshScheduled = false;
            refreshConvertButtons();
        }, 200);
    }

    function watchFeatureEditor() {
        try {
            sdk.Events.on({
                eventName: "wme-selection-changed",
                eventHandler: () => scheduleRefresh(),
            });
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] wme-selection-changed event unavailable.`, error);
        }

        observer = new MutationObserver(() => {
            scheduleRefresh();
        });

        const sidebar = document.getElementById("sidebar") || document.body;
        observer.observe(sidebar, { childList: true, subtree: true });
    }

    /*
     * ---------------------------------------------------------
     * Initialisation
     * ---------------------------------------------------------
     */

    async function initialise() {
        try {
            console.log(`[${SCRIPT_NAME}] Initialising...`);

            if (typeof getWmeSdk !== "function") throw new Error("WME SDK is unavailable.");

            const wmeSdk = getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });

            await wmeSdk.Events.once({ eventName: "wme-ready" });
            console.log(`[${SCRIPT_NAME}] WME SDK ready.`);

            sdk = wmeSdk;

            if (typeof initWmeSdkPlus === "function") {
                try {
                    const sdkPlus = await initWmeSdkPlus(wmeSdk, {
                        hooks: ["DataModel.PermanentHazards"],
                    });
                    if (sdkPlus) sdk = sdkPlus;
                } catch (e) {
                    console.warn(`[${SCRIPT_NAME}] wme-sdk-plus init skipped, using native fallbacks:`, e);
                }
            }

            window.wmeSchoolShortcutsSdk = sdk;

            registerShortcutGroup();
            const shortcuts = registerKeyboardShortcuts();
            console.log(`[${SCRIPT_NAME}] Shortcuts registered.`, shortcuts);

            watchFeatureEditor();
            console.log(`[${SCRIPT_NAME}] Feature editor watcher active.`);

            console.log(`[${SCRIPT_NAME}] Initialisation complete.`);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Initialisation failed.`, error);
            alert(`${SCRIPT_NAME}\n\nInitialisation failed:\n\n${error?.message || error}`);
        }
    }

    /*
     * ---------------------------------------------------------
     * Start
     * ---------------------------------------------------------
     */

    if (window.SDK_INITIALIZED && typeof window.SDK_INITIALIZED.then === "function") {
        window.SDK_INITIALIZED.then(initialise);
    } else {
        console.error(`[${SCRIPT_NAME}] SDK_INITIALIZED is unavailable.`);
    }
})();