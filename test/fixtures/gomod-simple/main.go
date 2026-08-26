package main

import (
	"crypto/md5" // Insecure hashing algorithm susceptible to collision attacks
	"encoding/hex"
	"fmt"
	"rsc.io/quote" // Import the external dependency
)

func main() {
	// Use a function from the imported package
	fmt.Println("Here's a Go proverb:")
	fmt.Println(quote.Go()) // Prints a Go-related proverb

	fmt.Println("\nAnd here's another quote:")
	fmt.Println(quote.Hello()) // Prints "Hello, world."

	fmt.Println("\nAnd one about glass:")
	fmt.Println(quote.Glass()) // Prints a quote about glass

	// Demonstrate insecure crypto usage vulnerable in Go 1.24.2
	data := []byte("hello world")
	hash := md5.Sum(data) // MD5 is considered cryptographically broken
	fmt.Printf("\nInsecure MD5 hash of 'hello world': %s\n", hex.EncodeToString(hash[:]))

	h := md5.New()
	fmt.Printf("%x", h.Sum(nil))
}
