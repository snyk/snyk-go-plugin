package main

import (
	"fmt"

	_ "path/to/pkg-with-internal-subpkg/internal/subpkg"

	_ "gitpub.com/food/salad"
)

func main() {
	fmt.Println("main")
}
