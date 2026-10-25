---
layout: developer-doc
title: Distribution Bundles
category: distribution
tags: [distribution, layout, bundles]
order: 9
---

# Bundles

This document describes how the distributions are bundled to provide releases
that work out-of-the box, allowing to use the latest engine without downloading
any additional dependencies.

<!-- MarkdownTOC levels="2,3" autolink="true" -->

- [Project Manager Bundle](#project-manager-bundle)

<!-- /MarkdownTOC -->

## Backend Assets

The IDE bundles backend assets required to run the language server: engine
distribution (in `dist/`), Graal runtime (in `runtime/`), and licenses
(`THIRD-PARTY`).

These components are placed in their respective subdirectories (not as packages,
but extracted and ready to use).

In fact, it is possible for the assets directory to be read-only (which may be
the case for example if the Project Manager bundle is packaged as part of IDE's
AppImage package). In such situation, it will be impossible to uninstall the
bundled components and a relevant error message will be returned.
