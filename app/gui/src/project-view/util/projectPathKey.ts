/**
 * The key `ProjectPath.key()` gives a project path, from its parts: a path of `Main` or
 * `Main.<rest>` is the project's own (`Main` dropped). Its own module so the docs site's generator
 * can compute a type's colour key (`computeNodeColor` hashes it) without the AST.
 */
export function projectPathKey(project: string | undefined, path: string | undefined): string {
  const main = path?.match(/^Main(?:\.(.+))?$/)
  const normalizedPath = main ? main[1] : path
  const projectKey = project ?? '$'
  return normalizedPath ? `${projectKey}.${normalizedPath}` : projectKey
}
