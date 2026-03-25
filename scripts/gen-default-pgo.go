// gen-default-pgo writes a minimal CPU profile for PGO fixture maintenance.
// Usage: go run scripts/gen-default-pgo.go path/to/default.pgo
package main

import (
	"os"
	"runtime/pprof"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		panic("usage: go run scripts/gen-default-pgo.go <output.pgo>")
	}
	f, err := os.Create(os.Args[1])
	if err != nil {
		panic(err)
	}
	pprof.StartCPUProfile(f)
	sum := 0
	for i := 0; i < 10_000_000; i++ {
		sum += i * i
	}
	_ = sum
	time.Sleep(100 * time.Millisecond)
	pprof.StopCPUProfile()
	f.Close()
}
