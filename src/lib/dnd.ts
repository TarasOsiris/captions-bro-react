// Shared drag-and-drop payload contract between the Media panel (drag source) and
// the Timeline (drop target). The dataTransfer value is the MediaAsset id; the drop
// handler looks it up in project.assets and creates a new clip from it.
export const MEDIA_ASSET_MIME = 'application/x-cb-asset'
