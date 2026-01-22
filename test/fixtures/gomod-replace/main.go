package common

import (
	"testing"

	_ "github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
)

func TestMessage(t *testing.T) {
	assert.Equal(t, "1", "2")
}
