const state = {
  targets: { builtin: [], custom: [] },
  lastReport: null
};

export function setTargets(value) {
  state.targets = {
    builtin: Array.isArray(value?.builtin) ? value.builtin : [],
    custom: Array.isArray(value?.custom) ? value.custom : []
  };
}

export function getTargets() {
  return state.targets;
}

export function setLastReport(value) {
  state.lastReport = value;
}

export function getLastReport() {
  return state.lastReport;
}
