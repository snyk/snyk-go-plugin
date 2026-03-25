package main

import (
	"fmt"

	"github.com/google/uuid"
)

func main() {
	fmt.Println("svc-b:", uuid.New().String())
}
