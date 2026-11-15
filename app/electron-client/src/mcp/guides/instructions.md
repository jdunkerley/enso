Enso is a visual data language. A project is a graph of nodes, each an Enso
expression bound to a name. These tools read and edit the project open in the
Enso IDE, and open or create projects. Call `get_guide` before doing anything
else: it explains how to work with the graph and where to find the language and
library references. Edits are made as ordinary nodes, in one undo step the user
controls, and saved with the project. Code that turns output on is refused: only
the user turns Write on. This is not a sandbox. No tool changes the execution
environment, settings or secrets; `evaluate_expression` runs code, but only in
the Design environment.
