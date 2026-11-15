Enso is a visual data language. A project is a graph of nodes, each an Enso
expression bound to a name. These tools read and edit the project open in the
Enso IDE, and open or create projects. Call `get_guide` before doing anything
else: it explains how to work with the graph and where to find the language and
library references. Edits are made as ordinary nodes, in one undo step the user
controls; the user, not you, writes the result to disk. No tool changes the
execution environment, settings or secrets; `evaluate_expression` runs code, but
only in the Design environment.
