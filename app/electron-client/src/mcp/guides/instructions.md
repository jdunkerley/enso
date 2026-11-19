A project in the Enso IDE is a graph of nodes, each an Enso expression bound to
a name. These tools read and edit the open project. Call `get_guide` first. Do
not turn Write on. Code that enables the output context (`with_enabled_context`,
`with_enabled`, binding a runtime builtin, reflection, looking a method up by a
name in text, or evaluating text as code) is refused. Only the user turns Write
on, by clicking it on a node. Your edits can still cause a write in two ways:
calling a function in the user's project that enables output, and changing a
node upstream of one the user switched Write on for (it re-runs). Ask the user
before either. Prefer Table and Column methods to `map`, and `Data.read_many` to
one read per file.
