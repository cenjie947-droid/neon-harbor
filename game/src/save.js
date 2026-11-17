// Neon Harbor — save data in localStorage: cash, highest unlocked mission,
// player position, health and wanted level.
const KEY = 'neon-harbor-save-v1';

export class SaveData {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (typeof data.cash !== 'number' || typeof data.missionIndex !== 'number') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  save(G) {
    try {
      const data = {
        cash: G.cash,
        missionIndex: Math.min(G.missionIndex, 4),
        pos: { x: G.player.pos.x, z: G.player.pos.z },
        health: G.player.health,
        wanted: G.wanted,
        savedAt: Date.now(),
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  apply(G, data) {
    G.cash = data.cash || 0;
    G.player.health = data.health > 0 ? data.health : 100;
    G.wanted = 0; // always start clean after loading
    if (data.pos) {
      G.player.pos.set(data.pos.x, 0, data.pos.z);
      G.player.mesh.position.copy(G.player.pos);
    }
    return data.missionIndex || 0;
  }

  exists() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }
}
