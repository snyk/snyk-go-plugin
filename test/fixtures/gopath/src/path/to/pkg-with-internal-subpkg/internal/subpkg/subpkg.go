package subpkg

import (
	"fmt"

	_ "gitpub.com/meal/dinner"
)

func init() {
	fmt.Println("subpkg")
}
