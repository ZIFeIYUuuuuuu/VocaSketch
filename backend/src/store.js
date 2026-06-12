const sessions = new Map();
const projects = new Map();
const interpretations = new Map();

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function saveSession(session) {
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function saveProject(project) {
  projects.set(project.projectId, project);
  return project;
}

export function getProject(projectId) {
  return projects.get(projectId);
}

export function saveInterpretation(interpretation) {
  interpretations.set(interpretation.interpretationId, interpretation);
  return interpretation;
}

export function getInterpretation(interpretationId) {
  return interpretations.get(interpretationId);
}
