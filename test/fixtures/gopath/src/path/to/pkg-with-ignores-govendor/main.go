package main

import (
	"fmt"

	_ "gitpub.com/food/salad"
	_ "gitpub.com/meal/dinner"

	_ "github.com/ignore/me"
	_ "github.com/ignore/me/deep"

	_ "gitpub.com/nature/vegetables"
)

func main() {
	fmt.Println("main")
}
