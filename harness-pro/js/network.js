// network.js — reine Graph-Logik fuer den Netzwerk-Canvas (kein DOM, testbar).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NetworkGraph = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  function rel(role, key) {
    var r = role && role.relationships;
    return r && Array.isArray(r[key]) ? r[key] : [];
  }

  function unique(list) {
    var seen = {};
    var out = [];
    list.forEach(function (id) {
      if (!seen[id]) { seen[id] = true; out.push(id); }
    });
    return out;
  }

  // Tiefe = laengste Kette ueber superiors (0 = niemandem unterstellt)
  function computeDepths(byId) {
    var depth = {};
    function visit(id, stack) {
      if (depth[id] !== undefined) return depth[id];
      if (stack.indexOf(id) >= 0) return 0; // Zyklus: defensiv
      var role = byId[id];
      var superiors = rel(role, 'superiors');
      if (!superiors.length) { depth[id] = 0; return 0; }
      var max = 0;
      superiors.forEach(function (sid) {
        if (!byId[sid]) return;
        max = Math.max(max, visit(sid, stack.concat(id)) + 1);
      });
      depth[id] = max;
      return max;
    }
    Object.keys(byId).forEach(function (id) { visit(id, []); });

    // Peers auf dieselbe Ebene ziehen (horizontale Linie)
    Object.keys(byId).forEach(function (id) {
      rel(byId[id], 'peers').forEach(function (pid) {
        if (!byId[pid]) return;
        var d = Math.max(depth[id] || 0, depth[pid] || 0);
        depth[id] = d;
        depth[pid] = d;
      });
    });
    return depth;
  }

  function buildNetwork(roles) {
    var list = Array.isArray(roles) ? roles.filter(function (r) { return r && r.id; }) : [];
    var byId = {};
    list.forEach(function (r) { byId[r.id] = r; });

    var depths = computeDepths(byId);
    var nodes = list.map(function (r) {
      return { id: r.id, label: r.name || r.id, depth: depths[r.id] || 0, model: r.model || 'astra' };
    });

    var seen = {};
    var edges = [];
    function push(from, to, kind) {
      var key = from + '->' + to;
      if (seen[key]) return;
      seen[key] = true;
      edges.push({ from: from, to: to, kind: kind, key: key });
    }

    list.forEach(function (r) {
      // superior-Kante: von mir nach oben
      rel(r, 'superiors').forEach(function (sid) {
        if (byId[sid]) push(r.id, sid, 'superior');
      });
      // Peer-Kante: einmal pro Paar, gestrichelt
      rel(r, 'peers').forEach(function (pid) {
        if (!byId[pid]) return;
        if (r.id < pid) push(r.id, pid, 'peer');
      });
    });

    return { nodes: nodes, edges: edges };
  }

  // Layout: Zeile = Tiefe, Spalte = Position in der Zeile
  function layout(network, width, rowHeight) {
    var w = Number(width) || 880;
    var rh = Number(rowHeight) || 120;
    var rows = {};
    (network.nodes || []).forEach(function (n) {
      rows[n.depth] = rows[n.depth] || [];
      rows[n.depth].push(n);
    });
    var maxDepth = 0;
    Object.keys(rows).forEach(function (d) { maxDepth = Math.max(maxDepth, Number(d)); });

    var placed = {};
    Object.keys(rows).forEach(function (d) {
      var row = rows[d];
      var gap = w / (row.length + 1);
      row.forEach(function (n, i) {
        placed[n.id] = {
          id: n.id,
          label: n.label,
          depth: Number(d),
          x: Math.round(gap * (i + 1)),
          y: 40 + Number(d) * rh,
        };
      });
    });
    return { nodes: placed, width: w, height: 80 + maxDepth * rh };
  }

  // Kante fuer ein Task-Event finden (Richtung egal: source->target oder target->source)
  function edgeFor(network, sourceRole, targetRole) {
    var edges = (network && network.edges) || [];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      if ((e.from === sourceRole && e.to === targetRole) || (e.from === targetRole && e.to === sourceRole)) {
        return e;
      }
    }
    return null;
  }

  return { buildNetwork: buildNetwork, layout: layout, edgeFor: edgeFor, computeDepths: computeDepths };
});
