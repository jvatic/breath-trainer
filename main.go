package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func MainHandler(w http.ResponseWriter, req *http.Request) {
	start := time.Now()
	fmt.Printf("%s %s [start]\n", req.Method, req.URL)
	defer fmt.Printf("%s %s [done in %s]\n", req.Method, req.URL, time.Since(start))
	path := req.URL.String()
	if path == "/" {
		path = "/index.html"
	}
	path = strings.TrimPrefix(path, "/")
	http.ServeFile(w, req, filepath.Join("./assets", path))
}

func main() {
	http.HandleFunc("/", MainHandler)
	err := http.ListenAndServe(":"+os.Getenv("PORT"), nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
