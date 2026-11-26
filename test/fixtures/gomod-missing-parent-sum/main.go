package main

import (
	"fmt"

	"cloud.google.com/go/compute/metadata"
)

func main() {
	fmt.Println(metadata.OnGCE())
}
