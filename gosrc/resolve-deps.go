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

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/build"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// Pkg represents a Go source package, and its dependencies.
type Pkg struct {
	Name           string
	FullImportPath string
	Dir            string
	Depth          int `json:"-"`

	IsBuiltin  bool `json:"-"`
	IsResolved bool `json:"-"`

	ResolveContext *ResolveContext `json:"-"`
	Parent         *Pkg            `json:"-"`
	ParentDir      string          `json:"-"`
	Deps           []Pkg           `json:"-"`

	Raw *build.Package `json:"-"`
}

// Resolve recursively finds all dependencies for the Pkg and the packages it depends on.
func (p *Pkg) Resolve() {
	// IsResolved is always true, regardless of if we skip the import,
	// it is only false if there is an error while importing.
	p.IsResolved = true

	name := p.cleanName()
	if name == "" {
		return
	}

	// Stop resolving imports if we've reached a loop.
	var importMode build.ImportMode
	if p.ResolveContext.hasSeenImport(name) && p.isAncestor(name) {
		importMode = build.FindOnly
	}

	pkg, err := build.Default.Import(name, p.ParentDir, importMode)
	if err != nil {
		// TODO: Check the error type?
		p.IsResolved = false
		// this is package we dediced to scan, and probably shouldn't have.
		// probably can remove this when we have handling of build tags
		if name != "." {
			p.ResolveContext.markUnresolvedPkg(name)
		}
		return
	}
	if name == "." && p.ResolveContext.shouldIgnorePkg(pkg.ImportPath) {
		p.IsResolved = false
		return
	}

	p.Raw = pkg
	p.Dir = pkg.Dir

	// Clear some too verbose fields
	p.Raw.ImportPos = nil
	p.Raw.TestImportPos = nil

	// Update the name with the fully qualified import path.
	p.FullImportPath = pkg.ImportPath
	// If this is an builtin package, we don't resolve deeper
	if pkg.Goroot {
		p.IsBuiltin = true
		return
	}

	imports := pkg.Imports
	p.setDeps(imports, pkg.Dir)
}

// setDeps takes a slice of import paths and the source directory they are relative to,
// and creates the Deps of the Pkg. Each dependency is also further resolved prior to being added
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

		p.addDep(imp, parentDir)
	}

	sort.Sort(sortablePkgsList(p.Deps))
}

// addDep creates a Pkg and it's dependencies from an imported package name.
func (p *Pkg) addDep(name string, parentDir string) {
	var dep Pkg
	cached := p.ResolveContext.getCachedPkg(name)
	if cached != nil {
		dep = *cached
		dep.ParentDir = parentDir
		dep.Parent = p
	} else {
		dep = Pkg{
			Name:           name,
			ResolveContext: p.ResolveContext,
			//TODO: maybe better pass ParentDir as a param to Resolve() instead
			ParentDir: parentDir,
			Parent:    p,
		}
		dep.Resolve()

		p.ResolveContext.cacheResolvedPackage(&dep)
	}

	p.Depth = p.depth()

	if dep.IsBuiltin || dep.Name == "C" {
		return
	}

	if isInternalImport(dep.Name) {
		p.Deps = append(p.Deps, dep.Deps...)
	} else {
		p.Deps = append(p.Deps, dep)
	}
}

// depth returns the depth of the Pkg within the tree.
func (p *Pkg) depth() int {
	if p.Parent == nil {
		return 0
	}

	return p.Parent.depth() + 1
}

// isAncestor goes recursively up the chain of Pkgs to determine if the name provided is ever a
// parent of the current Pkg.
func (p *Pkg) isAncestor(name string) bool {
	if p.Parent == nil {
		return false
	}

	if p.Parent.Name == name {
		return true
	}

	return p.Parent.isAncestor(name)
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
	if b[i].IsBuiltin && !b[j].IsBuiltin {
		return true
	} else if !b[i].IsBuiltin && b[j].IsBuiltin {
		return false
	}

	return b[i].Name < b[j].Name
}

type walkFunc func(path string) error

func walkGoFolders(root string, cb walkFunc) error {
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			return nil
		}

		folderName := info.Name()
		switch folderName {
		case "vendor", "Godeps", "node_modules", "testdata", "internal":
			return filepath.SkipDir
		}
		if strings.HasSuffix(folderName, "_test") ||
			(folderName != "." && strings.HasPrefix(folderName, ".")) {
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

// ResolveContext represents all the pkg trees rooted at all the subfolders with Go code.
type ResolveContext struct {
	Roots []*Pkg

	UnresolvedPkgs map[string]struct{}
	PkgCache       map[string]*Pkg
	importCache    map[string]struct{}

	ignoredPkgs []string
}

// Resolve recursively finds all direct & transitive dependencies for all the packages (and sub-packages),
// rooted at given path
func (rc *ResolveContext) Resolve(rootPath string, ignoredPkgs []string) error {
	rc.Roots = []*Pkg{}
	rc.importCache = map[string]struct{}{}
	rc.UnresolvedPkgs = map[string]struct{}{}
	rc.PkgCache = map[string]*Pkg{}
	rc.ignoredPkgs = ignoredPkgs

	abs, err := filepath.Abs(rootPath)
	if err != nil {
		return fmt.Errorf("filepath.Abs(%s) failed with: %s", rootPath, err.Error())
	}
	rootPath = abs

	rootImport, err := build.Default.Import(".", rootPath, build.FindOnly)
	if err != nil {
		return err
	}
	if rootImport.ImportPath == "" || rootImport.ImportPath == "." {
		return fmt.Errorf("Can't resolve root package at %s.\nIs $GOATH defined correctly?", rootPath)
	}

	virtualRootPkg := &Pkg{
		Name:           ".",
		FullImportPath: rootImport.ImportPath,
		Dir:            rootImport.Dir,
	}

	rc.Roots = append(rc.Roots, virtualRootPkg)

	return walkGoFolders(rootPath, func(path string) error {
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("filepath.Abs(%s) failed with: %s", path, err.Error())
		}

		rootPkg := &Pkg{
			Name:           ".",
			ResolveContext: rc,
			ParentDir:      absPath,
		}
		rootPkg.Resolve()
		rootPkg.Name = rootPkg.FullImportPath

		if rootPkg.IsResolved {
			rc.Roots = append(rc.Roots, rootPkg)
		}

		return nil
	})
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
	rc.UnresolvedPkgs[name] = struct{}{}
}

func (rc *ResolveContext) cacheResolvedPackage(pkg *Pkg) {
	rc.PkgCache[pkg.Name] = pkg
}

func (rc *ResolveContext) getCachedPkg(name string) *Pkg {
	pkg, ok := rc.PkgCache[name]
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

// GraphOptions is Graph's options
type GraphOptions struct {
	Directed   bool `json:"directed"`
	Multigraph bool `json:"multigraph"`
	Compound   bool `json:"compound"`
}

// Graph is graph that when marshaled to JSON can be imported via Graphlib JS pkg from NPM
type Graph struct {
	Nodes   []Node       `json:"nodes"`
	Edges   []Edge       `json:"edges"`
	Options GraphOptions `json:"options"`
}

func (rc *ResolveContext) getGraph() Graph {
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

		for _, child := range pkg.Deps {
			edge := Edge{
				From: pkg.Name,
				To:   child.Name,
			}
			edgesMap[pkg.Name+":"+child.Name] = edge

			recurse(&child)
		}
	}

	for _, r := range rc.Roots {
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
		Options: GraphOptions{
			Directed: true,
		},
	}
}

func (g Graph) toDOT() string {
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

func (g Graph) sortedNodeNames() []string {
	names := []string{}

	for _, n := range g.Nodes {
		names = append(names, n.Name)
	}

	sort.Strings(names)
	return names
}

func prettyPrintJSON(j interface{}) {
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	e.Encode(j)
}

func main() {
	flag.Usage = func() {
		fmt.Println(`  Scans the imports from all Go pacakges (and subpackages) rooted in current dir,
  and prints the dependency graph in a JSON format that can be imported via npmjs.com/graphlib.
		`)
		flag.PrintDefaults()
		fmt.Println("")
	}
	var ignoredPkgs = flag.String("ignoredPkgs", "", "Comma seperated list of packges (cannonically named) to ignore when scanning subfolders")
	var outputDOT = flag.Bool("dot", false, "Output as Graphviz DOT format")
	var outputList = flag.Bool("list", false, "Output a flat JSON array of all reachable deps")
	flag.Parse()

	ignoredPkgsList := strings.Split(*ignoredPkgs, ",")

	var rc ResolveContext
	err := rc.Resolve(".", ignoredPkgsList)
	if err != nil {
		panic(err)
	}

	graph := rc.getGraph()

	if *outputDOT {
		fmt.Println(graph.toDOT())
	} else if *outputList {
		prettyPrintJSON(graph.sortedNodeNames())
	} else {
		prettyPrintJSON(graph)
	}

	if len(rc.UnresolvedPkgs) != 0 {
		fmt.Println("\nUnresolved packages:")

		unresolved := []string{}
		for pkg := range rc.UnresolvedPkgs {
			unresolved = append(unresolved, pkg)
		}
		sort.Strings(unresolved)
		for _, pkg := range unresolved {
			fmt.Println(" - ", pkg)
		}

		os.Exit(1)
	}
}
