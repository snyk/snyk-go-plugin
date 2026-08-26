module github.com/snyk-test/test-repo

go 1.24.0

require (
	// Edge case: module with a major version suffix
	github.com/go-chi/chi/v5 v5.2.5
	// Edge case: module with a +incompatible version
	github.com/go-redis/redis v6.15.9+incompatible
	// Edge case: module that gets replaced with a fork
	github.com/golang/mock v1.6.0
	// Edge case: module that gets replaced with a local sub-directory
	github.com/snyk-test/test-repo/submodule v0.0.0
	// Edge case: module that gets replaced with a different release
	github.com/stretchr/testify v1.9.0
	// Edge case: module with v1 suffix and pseudo version
	gopkg.in/check.v1 v1.0.0-20201130134442-10cb98267c6c
	// Edge case: module with v3 suffix and exact version
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/kr/pretty v0.3.1 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/onsi/ginkgo v1.16.5 // indirect
	github.com/onsi/gomega v1.39.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rogpeppe/go-internal v1.13.1 // indirect
)

// replace with different release
replace github.com/stretchr/testify v1.6.0 => github.com/stretchr/testify v1.6.1

// replace with a fork
replace github.com/golang/mock => github.com/n1lesh/mock v1.6.0

// replace with relative path
replace github.com/snyk-test/test-repo/submodule => ./submodule
