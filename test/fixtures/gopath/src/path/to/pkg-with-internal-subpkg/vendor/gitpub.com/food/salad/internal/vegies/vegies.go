package vegies

import (
	"fmt"

	_ "gitpub.com/nature/vegetables/cucamba"
	_ "gitpub.com/nature/vegetables/tomato"
)

func init() {
	fmt.Println("internal vegies")
}
