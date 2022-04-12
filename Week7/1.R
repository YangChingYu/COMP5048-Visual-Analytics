library(networkD3)
Energy <- jsonlite::fromJSON("/Users/kevin/Project/2022/4 COMP5048 Visual Analytics/4-COMP5048-Visual-Analytics-code/Week7/energy.json")
View(Energy)
sankeyNetwork(Links = Energy$links, Nodes = Energy$nodes, Source = "source", Target = "target", Value = "value", NodeID = "name", units = "TWh", fontSize = 12, nodeWidth = 30, width=1300, height=800)
