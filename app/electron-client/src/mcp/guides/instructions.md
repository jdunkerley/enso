Enso is a visual data language. A project is a graph of nodes, each an Enso
expression bound to a name. These tools read the project that is open in the
Enso IDE. Call `get_guide` before doing anything else: it explains how to work
with the graph and where to find the language and library references. None of
these tools edits the project or changes its execution environment, settings or
secrets; `evaluate_expression` runs code, but only in the Design environment.
