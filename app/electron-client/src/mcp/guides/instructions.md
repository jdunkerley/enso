A project in the Enso IDE is a graph of nodes, each an Enso expression bound to
a name. These tools read and edit the open project. Call `get_guide` first. Do
not turn Write on. Code that enables the output context (`with_enabled_context`,
`with_enabled`, binding a runtime builtin, or building a method name by
reflection) is refused. Only the user turns Write on, by clicking it on a node.
Your edits can still cause a write in two ways you should avoid: calling a
function in the user's project that itself enables output, and changing a node
upstream of one the user has switched Write on for (it re-runs with your
change). Ask the user before doing either.
