module github.com/snyk-test/test-repo

go 1.14

require (
	github.com/golang/mock v1.6.0
	github.com/stretchr/testify v1.6.0
)

replace github.com/stretchr/testify v1.6.0 => github.com/stretchr/testify v1.6.1

// replace with a fork
replace github.com/golang/mock => github.com/n1lesh/mock v1.6.0
