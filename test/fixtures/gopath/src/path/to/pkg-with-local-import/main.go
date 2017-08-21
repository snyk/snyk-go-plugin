package main

import (
	"fmt"

	_ "path/to/pkg-with-local-import/subpkg"

	_ "gitpub.com/food/salad"
)

func main() {
	fmt.Println("main")
}
