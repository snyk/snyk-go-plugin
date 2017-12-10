package main

import (
	"fmt"

	_ "gitpub.com/meal/dinner"
	_ "path/to/multiroot-pkg-without-root/lib"
)

func main() {
	fmt.Println("main")
}
