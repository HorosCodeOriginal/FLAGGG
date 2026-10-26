// task-events.js — reine Logik fuer den Live-Canvas (kein DOM, testbar in Node).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TaskEvents = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var MAX_TIMELINE = 5;

  function roleOf(evt) {
    return (evt && (evt.roleId || evt.sourceRole)) || 'system';
  }

  function shortId(taskId) {
    return String(taskId || '').slice(0, 8);
  }

  function timelineText(evt) {
    if (!evt) return '';
    var role = roleOf(evt);
    var id = shortId(evt.taskId);
    switch (evt.toState) {
      case 'queued': return role + ' hat Task ' + id + ' eingereiht';
      case 'claimed': return role + ' hat Task ' + id + ' uebernommen';
      case 'running': return role + ' fuehrt Task ' + id + ' aus';
      case 'waiting_on_child': return role + ' wartet auf Kind-Tasks (' + id + ')';
      case 'done': return 'Task ' + id + ' von ' + role + ' abgeschlossen';
      case 'failed': return 'Task ' + id + ' bei ' + role + ' fehlgeschlagen';
      case 'cancelled': return 'Task ' + id + ' abgebrochen';
      case 'escalated': return 'Task ' + id + ' eskaliert (' + role + ')';
      default: return role + ': ' + (evt.fromState || '?') + ' -> ' + (evt.toState || '?');
    }
  }

  // Event in den UI-State uebernehmen (Timeline + Knoten-Status)
  function applyTaskEvent(state, evt) {
    if (!state || !evt) return state;
    if (!Array.isArray(state.taskTimeline)) state.taskTimeline = [];
    if (!state.taskNodes || typeof state.taskNodes !== 'object') state.taskNodes = {};

    state.taskTimeline.unshift({
      id: evt.id,
      text: timelineText(evt),
      at: evt.timestamp || new Date().toISOString(),
      state: evt.toState,
      role: roleOf(evt),
    });
    while (state.taskTimeline.length > MAX_TIMELINE) state.taskTimeline.pop();

    var role = evt.roleId || evt.sourceRole;
    if (role) {
      state.taskNodes[role] = {
        state: evt.toState,
        taskState: evt.taskState || evt.toState,
        taskId: evt.taskId,
        at: evt.timestamp || new Date().toISOString(),
      };
    }
    return state;
  }

  // visueller Zustand eines Knotens: failed | running | done | ''
  function nodeStatus(state, roleId) {
    var node = state && state.taskNodes && state.taskNodes[roleId];
    if (!node) return '';
    if (node.taskState === 'failed' || node.state === 'failed') return 'failed';
    if (node.taskState === 'running' || node.taskState === 'claimed' || node.taskState === 'waiting_on_child') return 'running';
    if (node.taskState === 'done') return 'done';
    return '';
  }

  function nodeClass(state, roleId) {
    var status = nodeStatus(state, roleId);
    return status ? ' ' + status : '';
  }

  return {
    MAX_TIMELINE: MAX_TIMELINE,
    roleOf: roleOf,
    timelineText: timelineText,
    applyTaskEvent: applyTaskEvent,
    nodeStatus: nodeStatus,
    nodeClass: nodeClass,
  };
});
