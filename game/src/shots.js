// Neon Harbor — screenshot staging: ?shot=start shows the title screen over
// the city, ?shot=play stages a busy mid-action chase, ?shot=end stages the
// mission-complete moment. Each stage renders twice, then sets
// window.__shotReady so a screenshot tool knows the frame is ready.
import * as THREE from 'three';
import { enterCar } from './vehicles.js';

export function stageShot(G, shot) {
  const renderTwice = () => {
    G.renderer.render(G.scene, G.camera);
    G.renderer.render(G.scene, G.camera);
  };
  if (shot === 'start') {
    // title screen over a slow city view
    G.player.pos.set(-60, 0, -34);
    G.player.heading = 0.6;
    G.cameraYaw = 0.6; G.cameraPitch = 0.35;
    G.camera.position.set(-60 + Math.sin(0.6) * 7.5, 5.5, -34 + Math.cos(0.6) * 7.5);
    G.camera.lookAt(-60, 1.7, -34);
    document.getElementById('title-screen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    renderTwice();
  } else if (shot === 'play') {
    // mid-action: Cole driving the Comet GT through downtown, police chasing,
    // 3 stars, mission 2 objective on the HUD, traffic and pedestrians around
    document.getElementById('title-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.show();
    G.missions.startMission(G, 1, false);
    G.missionStep = 1; // at the pickup step
    G.missions.applyStep(G);
    G.wanted = 3;
    const comet = G.cometGT;
    comet.pos.set(0, 0, 60);
    comet.heading = Math.PI;
    comet.speed = 18;
    enterCar(G, comet);
    G.player.car = comet;
    // police cars in pursuit, ahead of the player so the chase reads in frame
    const policeSpots = [[-9, 42], [9, 34]];
    for (let i = 0; i < 2; i++) {
      const pc = G.police.spawnPoliceCar(G);
      pc.pos.set(policeSpots[i][0], 0, policeSpots[i][1]);
      pc.heading = Math.PI;
      pc.speed = 20;
      pc.mesh.position.copy(pc.pos);
    }
    // traffic and pedestrians in view
    for (let i = 0; i < 4 && i < G.traffic.length; i++) {
      const t = G.traffic[i];
      t.pos.set(-8 + i * 6, 0, 30 - i * 12);
      t.heading = 0; t.speed = 10;
      t.mesh.position.copy(t.pos);
    }
    G.camera.position.set(0, 5.5, 60 + 12);
    G.camera.lookAt(0, 1.6, 40);
    G.hud.showMessage('Package secured. The cops noticed — go!');
    G.hud.update(G, 0.016);
    renderTwice();
  } else if (shot === 'drive') {
    // free driving down the beach road: Cole in a red Stallion, traffic
    // ahead, palms and the sea to the side, HUD and minimap visible
    document.getElementById('title-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.show();
    G.missions.startMission(G, 0, false);
    G.missionStep = 1; // drive to the paint shop
    G.missions.applyStep(G);
    const car = G.cars.find(c => c.parked && c.name === 'Stallion') || G.cars[0];
    car.pos.set(-60, 0, 100);
    car.heading = 0;
    car.speed = 22;
    enterCar(G, car);
    G.player.car = car;
    for (let i = 0; i < 3 && i < G.traffic.length; i++) {
      const t = G.traffic[i];
      t.pos.set(-60 + (i % 2 === 0 ? 3.5 : -3.5), 0, 120 + i * 16);
      t.heading = 0; t.speed = 12;
      t.mesh.position.copy(t.pos);
    }
    G.camera.position.set(-60, 5, 89);
    G.camera.lookAt(-60, 1.6, 120);
    G.hud.update(G, 0.016);
    renderTwice();
  } else if (shot === 'end') {
    // mission-complete panel over the garage with the delivered car
    document.getElementById('title-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.show();
    G.missions.startMission(G, 0, false);
    G.missionIndex = 0;
    G.cash = 150; // mission 1 pays $150 and the player starts at $0
    const car = G.cars.find(c => c.parked) || G.cars[0];
    car.pos.set(G.markers.garage.x + 6, 0, G.markers.garage.z);
    car.heading = Math.PI / 2;
    car.mesh.position.copy(car.pos);
    G.player.pos.set(G.markers.garage.x - 2, 0, G.markers.garage.z + 2);
    G.player.heading = Math.PI / 2;
    G.player.mesh.position.copy(G.player.pos);
    document.getElementById('mission-panel-title').textContent = 'MISSION COMPLETE';
    document.getElementById('mission-panel-text').textContent = 'First Wheels — nicely driven, Cole.';
    document.getElementById('mission-panel-reward').textContent = 'Reward: $150  •  Total cash: $150';
    document.getElementById('mission-panel').classList.remove('hidden');
    G.camera.position.set(G.markers.garage.x - 14, 6, G.markers.garage.z + 12);
    G.camera.lookAt(G.markers.garage.x, 1.5, G.markers.garage.z);
    G.hud.setMissionName('Mission 1: First Wheels');
    G.hud.setObjective('Drive the car to the paint shop');
    G.hud.update(G, 0.016);
    renderTwice();
  }
  window.__shotReady = true;
}
