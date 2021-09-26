package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	"go/build"
	"path/filepath"
	"path"
)

func prettyPrintJSON(j interface{}) {
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	e.Encode(j)
}

func main() {
	flag.Usage = func() {
		fmt.Println(`  Scans the imports from all Go packages (and subpackages) rooted in current dir,
  and prints the dependency graph in a JSON format that can be imported via npmjs.com/graphlib.
		`)
		flag.PrintDefaults()
		fmt.Println("")
	}
	var ignoredPkgs = flag.String("ignoredPkgs", "", "Comma separated list of packages (canonically named) to ignore when scanning subfolders")
	var outputDOT = flag.Bool("dot", false, "Output as Graphviz DOT format")
	var outputList = flag.Bool("list", false, "Output a flat JSON array of all reachable deps")
	flag.Parse()

	ignoredPkgsList := strings.Split(*ignoredPkgs, ",")

	var rc ResolveContext
	err := rc.ResolvePath(".", ignoredPkgsList)
	if err != nil {
		panic(err)
	}

	graph := rc.GetGraph()

	if *outputDOT {
		fmt.Println(graph.ToDOT())
	} else if *outputList {
		prettyPrintJSON(graph.SortedNodeNames())
	} else {
		prettyPrintJSON(graph)
	}

	unresolved := rc.GetUnresolvedPackages()
	if len(unresolved) != 0 {
		fmt.Println("\nUnresolved packages:")

		sort.Strings(unresolved)
		for _, pkg := range unresolved {
			fmt.Println(" - ", pkg)
		}

		os.Exit(1)
	}
}

/*
This code is based on https://github.com/KyleBanks/depth

MIT License

Copyright (c) 2017 Kyle Banks

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/*
package resolver

import (
	"fmt"
	"go/build"
	"path/filepath"
	"strings"

	"./dirwalk"
	"./graph"
)

*/
// ResolveContext represents all the pkg trees rooted at all the subfolders with Go code.
type ResolveContext struct {
	roots []*Pkg

	unresolvedPkgs map[string]struct{}
	pkgCache       map[string]*Pkg
	importCache    map[string]struct{}

	ignoredPkgs []string
}

// ResolvePath recursively finds all direct & transitive dependencies for all the packages (and sub-packages),
// rooted at given path
func (rc *ResolveContext) ResolvePath(rootPath string, ignoredPkgs []string) error {
	rc.init()
	rc.ignoredPkgs = ignoredPkgs

	abs, err := filepath.Abs(rootPath)
	if err != nil {
		return fmt.Errorf("filepath.Abs(%s) failed with: %s", rootPath, err.Error())
	}
	rootPath = abs

	virtualRootPkg, err := rc.resolveVirtualRoot(rootPath)
	if err != nil {
		return err
	}
	rc.roots = append(rc.roots, virtualRootPkg)

	return WalkGoFolders(rootPath, func(path string) error {
		rootPkg := rc.resolveFolder(path)
		if rootPkg.isResolved {
			rc.roots = append(rc.roots, rootPkg)
		}

		return nil
	})
}

// GetUnresolvedPackages returns a list of all the pkgs that failed to resolve
func (rc ResolveContext) GetUnresolvedPackages() []string {
	unresolved := []string{}
	for pkg := range rc.unresolvedPkgs {
		unresolved = append(unresolved, pkg)
	}
	return unresolved
}

// GetGraph returns the graph of resolved packages
func (rc *ResolveContext) GetGraph() Graph {
	nodesMap := map[string]Node{}
	edgesMap := map[string]Edge{}

	var recurse func(pkg *Pkg)
	recurse = func(pkg *Pkg) {
		_, exists := nodesMap[pkg.Name]
		if exists {
			return
		}

		node := Node{
			Name:  pkg.Name,
			Value: *pkg,
		}
		nodesMap[pkg.Name] = node

		for _, child := range pkg.deps {
			edge := Edge{
				From: pkg.Name,
				To:   child.Name,
			}
			edgesMap[pkg.Name+":"+child.Name] = edge

			recurse(&child)
		}
	}

	for _, r := range rc.roots {
		recurse(r)
	}

	var nodes []Node
	for _, v := range nodesMap {
		nodes = append(nodes, v)
	}

	var edges []Edge
	for _, v := range edgesMap {
		edges = append(edges, v)
	}

	return Graph{
		Nodes: nodes,
		Edges: edges,
		Options: Options{
			Directed: true,
		},
	}
}

func (rc *ResolveContext) init() {
	rc.roots = []*Pkg{}
	rc.importCache = map[string]struct{}{}
	rc.unresolvedPkgs = map[string]struct{}{}
	rc.pkgCache = map[string]*Pkg{}
}

func (rc *ResolveContext) resolveVirtualRoot(rootPath string) (*Pkg, error) {
	rootImport, err := build.Default.Import(".", rootPath, build.FindOnly)
	if err != nil {
		return nil, err
	}
	if rootImport.ImportPath == "" || rootImport.ImportPath == "." {
		return nil, fmt.Errorf("Can't resolve root package at %s.\nIs $GOPATH defined correctly?", rootPath)
	}

	virtualRootPkg := &Pkg{
		Name:           ".",
		FullImportPath: rootImport.ImportPath,
		Dir:            rootImport.Dir,
	}

	return virtualRootPkg, nil
}

func (rc *ResolveContext) resolveFolder(path string) *Pkg {
	rootPkg := &Pkg{
		Name:           ".",
		resolveContext: rc,
		parentDir:      path,
	}
	rootPkg.Resolve()
	rootPkg.Name = rootPkg.FullImportPath

	return rootPkg
}

// hasSeenImport returns true if the import name provided has already been seen within the tree.
// This function only returns false for a name once.
func (rc *ResolveContext) hasSeenImport(name string) bool {
	if _, ok := rc.importCache[name]; ok {
		return true
	}
	rc.importCache[name] = struct{}{}
	return false
}

func (rc *ResolveContext) markUnresolvedPkg(name string) {
	rc.unresolvedPkgs[name] = struct{}{}
}

func (rc *ResolveContext) cacheResolvedPackage(pkg *Pkg) {
	rc.pkgCache[pkg.Name] = pkg
}

func (rc *ResolveContext) getCachedPkg(name string) *Pkg {
	pkg, ok := rc.pkgCache[name]
	if !ok {
		return nil
	}
	return pkg
}

func (rc ResolveContext) shouldIgnorePkg(name string) bool {
	for _, ignored := range rc.ignoredPkgs {
		if name == ignored {
			return true
		}

		if strings.HasSuffix(ignored, "*") {
			// note that ignoring "url/to/pkg*" will also ignore "url/to/pkg-other",
			// this is quite confusing, but is dep's behaviour
			if strings.HasPrefix(name, strings.TrimSuffix(ignored, "*")) {
				return true
			}
		}
	}

	return false
}

/*
package dirwalk

import (
	"os"
	"path/filepath"
	"strings"
)
*/

// WalkGoFolders will call cb for every folder with Go code under the given root path,
// unless it's:
// - one of "vendor", "Godeps", "node_modules", "testdata", "internal"
// - starts with "." or "_"
// - is a test package, i.e. ends with _test
func WalkGoFolders(root string, cb WalkFunc) error {
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		// if it's not a folder (or a symlink to folder), do nothing
		if info.Mode()&os.ModeSymlink > 0 {
			if info, err = os.Stat(path); err != nil {
				if os.IsNotExist(err) {
					// ignore broken symlinks
					return nil
				}
				return err
			}
		}
		if !info.IsDir() {
			return nil
		}

		folderName := info.Name()
		switch folderName {
		case "vendor", "Godeps", "node_modules", "testdata", "internal":
			return filepath.SkipDir
		}
		if strings.HasSuffix(folderName, "_test") ||
			(folderName != "." && strings.HasPrefix(folderName, ".")) ||
			strings.HasPrefix(folderName, "_") {
			return filepath.SkipDir
		}

		gofiles, err := filepath.Glob(filepath.Join(path, "*.go"))
		if err != nil {
			return nil
		}

		if len(gofiles) > 0 {
			return cb(path)
		}

		return nil
	})
	return err
}

// WalkFunc defines the prototype for WalkGoFolders's callback.
// the error passed as the return value of the undrelying filepath.Walk
type WalkFunc func(path string) error


/*
package graph

import (
	"fmt"
	"sort"
)
*/

// Node is Grpah's node
type Node struct {
	Name  string      `json:"v"`
	Value interface{} `json:"value"`
}

// Edge is Graph's edge
type Edge struct {
	From string `json:"v"`
	To   string `json:"w"`
}

// Options is Graph's options
type Options struct {
	Directed   bool `json:"directed"`
	Multigraph bool `json:"multigraph"`
	Compound   bool `json:"compound"`
}

// Graph is graph that when marshaled to JSON can be imported via Graphlib JS pkg from NPM
type Graph struct {
	Nodes   []Node  `json:"nodes"`
	Edges   []Edge  `json:"edges"`
	Options Options `json:"options"`
}

// ToDOT return graph as GraphViz .dot format string
func (g Graph) ToDOT() string {
	dot := "digraph {\n"

	id := 0
	nodeIDs := map[string]int{}

	for _, n := range g.Nodes {
		nodeIDs[n.Name] = id
		dot += fmt.Sprintf("\t%d [label=\"%s\"]\n", id, n.Name)
		id++
	}

	dot += "\n"

	for _, e := range g.Edges {
		dot += fmt.Sprintf("\t%d -> %d;\n", nodeIDs[e.From], nodeIDs[e.To])
	}
	dot += "}\n"

	return dot
}

// SortedNodeNames returns a sorted list of all the node names
func (g Graph) SortedNodeNames() []string {
	names := []string{}

	for _, n := range g.Nodes {
		names = append(names, n.Name)
	}

	sort.Strings(names)
	return names
}


/*
package resolver

import (
	"go/build"
	"path"
	"sort"
	"strings"
)
*/

// Pkg represents a Go source package, and its dependencies.
type Pkg struct {
	Name           string
	FullImportPath string
	Dir            string

	raw *build.Package

	isBuiltin      bool
	isResolved     bool
	parentDir      string
	deps           []Pkg
	parent         *Pkg
	resolveContext *ResolveContext
}

// Resolve recursively finds all dependencies for the Pkg and the packages it depends on.
func (p *Pkg) Resolve() {
	// isResolved is always true, regardless of if we skip the import,
	// it is only false if there is an error while importing.
	p.isResolved = true

	name := p.cleanName()
	if name == "" {
		return
	}

	// Stop resolving imports if we've reached a loop.
	var importMode build.ImportMode
	if p.resolveContext.hasSeenImport(name) && p.isAncestor(name) {
		importMode = build.FindOnly
	}

	pkg, err := build.Default.Import(name, p.parentDir, importMode)
	if err != nil {
		// TODO: Check the error type?
		p.isResolved = false
		// this is package we dediced to scan, and probably shouldn't have.
		// probably can remove this when we have handling of build tags
		if name != "." {
			p.resolveContext.markUnresolvedPkg(name)
		}
		return
	}
	if name == "." && p.resolveContext.shouldIgnorePkg(pkg.ImportPath) {
		p.isResolved = false
		return
	}

	p.raw = pkg
	p.Dir = pkg.Dir

	// Clear some too verbose fields
	p.raw.ImportPos = nil
	p.raw.TestImportPos = nil

	// Update the name with the fully qualified import path.
	p.FullImportPath = pkg.ImportPath
	// If this is an builtin package, we don't resolve deeper
	if pkg.Goroot {
		p.isBuiltin = true
		return
	}

	imports := pkg.Imports
	p.setDeps(imports, pkg.Dir)
}

// setDeps takes a slice of import paths and the source directory they are relative to,
// and creates the deps of the Pkg. Each dependency is also further resolved prior to being added
// to the Pkg.
func (p *Pkg) setDeps(imports []string, parentDir string) {
	unique := make(map[string]struct{})

	for _, imp := range imports {
		// Mostly for testing files where cyclic imports are allowed.
		if imp == p.Name {
			continue
		}

		// Skip duplicates.
		if _, ok := unique[imp]; ok {
			continue
		}
		unique[imp] = struct{}{}

		if p.resolveContext.shouldIgnorePkg(imp) {
			continue
		}

		p.addDep(imp, parentDir)
	}

	sort.Sort(sortablePkgsList(p.deps))
}

// addDep creates a Pkg and it's dependencies from an imported package name.
func (p *Pkg) addDep(name string, parentDir string) {
	var dep Pkg
	cached := p.resolveContext.getCachedPkg(name)
	if cached != nil {
		dep = *cached
		dep.parentDir = parentDir
		dep.parent = p
	} else {
		dep = Pkg{
			Name:           name,
			resolveContext: p.resolveContext,
			//TODO: maybe better pass parentDir as a param to Resolve() instead
			parentDir: parentDir,
			parent:    p,
		}
		dep.Resolve()

		p.resolveContext.cacheResolvedPackage(&dep)
	}

	if dep.isBuiltin || dep.Name == "C" {
		return
	}

	if isInternalImport(dep.Name) {
		p.deps = append(p.deps, dep.deps...)
	} else {
		p.deps = append(p.deps, dep)
	}
}

// isAncestor goes recursively up the chain of Pkgs to determine if the name provided is ever a
// parent of the current Pkg.
func (p *Pkg) isAncestor(name string) bool {
	if p.parent == nil {
		return false
	}

	if p.parent.Name == name {
		return true
	}

	return p.parent.isAncestor(name)
}

// cleanName returns a cleaned version of the Pkg name used for resolving dependencies.
//
// If an empty string is returned, dependencies should not be resolved.
func (p *Pkg) cleanName() string {
	name := p.Name

	// C 'package' cannot be resolved.
	if name == "C" {
		return ""
	}

	// Internal golang_org/* packages must be prefixed with vendor/
	//
	// Thanks to @davecheney for this:
	// https://github.com/davecheney/graphpkg/blob/master/main.go#L46
	if strings.HasPrefix(name, "golang_org") {
		name = path.Join("vendor", name)
	}

	return name
}

func isInternalImport(importPath string) bool {
	return strings.Contains(importPath, "/internal/")
}

// sortablePkgsList ensures a slice of Pkgs are sorted such that the builtin stdlib
// packages are always above external packages (ie. github.com/whatever).
type sortablePkgsList []Pkg

func (b sortablePkgsList) Len() int {
	return len(b)
}

func (b sortablePkgsList) Swap(i, j int) {
	b[i], b[j] = b[j], b[i]
}

func (b sortablePkgsList) Less(i, j int) bool {
	if b[i].isBuiltin && !b[j].isBuiltin {
		return true
	} else if !b[i].isBuiltin && b[j].isBuiltin {
		return false
	}

	return b[i].Name < b[j].Name
}
