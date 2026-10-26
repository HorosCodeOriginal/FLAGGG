'use strict';
// Tests der Netzwerk-Canvas-Logik (Knoten, gerichtete Kanten, Layout, Event-Kante).

const test = require('node:test');
const assert = require('node:assert');

const { buildNetwork, layout, edgeFor, computeDepths } = require('../js/network');

function graph() {
  return [
    { id: 'bossA', name: 'Boss A', relationships: { superiors: [], subordinates: ['dev'], peers: [] } },
    { id: 'bossB', name: 'Boss B', relationships: { superiors: [], subordinates: ['dev'], peers: [] } },
    { id: 'dev', name: 'Dev', relationships: { superiors: ['bossA', 'bossB'], subordinates: [], peers: ['qa'] } },
    { id: 'qa', name: 'QA', relationships: { superiors: [], subordinates: [], peers: ['dev'] } },
  ];
}

test('buildNetwork liefert Knoten und gerichtete Kanten (DoD 4)', () => {
  const net = buildNetwork(graph());
  assert.strictEqual(net.nodes.length, 4);
  const superiors = net.edges.filter(e => e.kind === 'superior');
  const peers = net.edges.filter(e => e.kind === 'peer');
  assert.strictEqual(superiors.length, 2, 'dev hat zwei superiors-Kanten');
  assert.deepStrictEqual(superiors.map(e => e.from + '->' + e.to).sort(), ['dev->bossA', 'dev->bossB']);
  assert.strictEqual(peers.length, 1, 'Peer-Kante wird nur einmal erzeugt');
  assert.strictEqual(net.edges.length, 3);
});

test('Tiefen: Vorgesetzte oben, Peers auf gleicher Ebene', () => {
  const roles = graph();
  const byId = {};
  roles.forEach(r => { byId[r.id] = r; });
  const depths = computeDepths(byId);
  assert.strictEqual(depths.bossA, 0);
  assert.strictEqual(depths.bossB, 0);
  assert.strictEqual(depths.dev, 1);
  assert.strictEqual(depths.qa, 1, 'Peer von dev wird auf dieselbe Ebene gezogen');
});

test('layout platziert jeden Knoten einmal mit x/y', () => {
  const net = buildNetwork(graph());
  const lay = layout(net, 800, 100);
  assert.strictEqual(Object.keys(lay.nodes).length, 4);
  Object.keys(lay.nodes).forEach(id => {
    assert.ok(Number.isFinite(lay.nodes[id].x));
    assert.ok(Number.isFinite(lay.nodes[id].y));
  });
  const bossY = lay.nodes.bossA.y;
  const devY = lay.nodes.dev.y;
  assert.ok(bossY < devY, 'Vorgesetzte stehen weiter oben');
  assert.ok(lay.height >= devY);
});

test('edgeFor findet die Kante in beiden Richtungen (fuer Event-Animation)', () => {
  const net = buildNetwork(graph());
  assert.ok(edgeFor(net, 'dev', 'bossA'));
  assert.ok(edgeFor(net, 'bossA', 'dev'), 'Event kann in Gegenrichtung kommen');
  assert.ok(edgeFor(net, 'dev', 'qa'));
  assert.strictEqual(edgeFor(net, 'bossA', 'qa'), null);
});

test('Zyklische superiors beenden die Tiefenberechnung nicht in Endlosschleife', () => {
  const cyclic = {
    a: { id: 'a', relationships: { superiors: ['b'], subordinates: [], peers: [] } },
    b: { id: 'b', relationships: { superiors: ['a'], subordinates: [], peers: [] } },
  };
  const depths = computeDepths(cyclic);
  assert.strictEqual(typeof depths.a, 'number');
  assert.strictEqual(typeof depths.b, 'number');
});
