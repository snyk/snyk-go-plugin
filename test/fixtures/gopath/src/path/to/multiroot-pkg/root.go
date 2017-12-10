package root

import (
	"fmt"

	_ "path/to/multiroot-pkg/lib"
)

func init() {
	fmt.Println("root")
}
