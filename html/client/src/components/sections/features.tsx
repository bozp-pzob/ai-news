import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { staggerContainer, fadeIn } from "@/lib/animations";
import { Brain, Database, FileText, RefreshCw } from "lucide-react";

const features = [
  {
    title: "Smart Aggregation",
    description: "Automatically collect and organize news from multiple sources using advanced AI algorithms.",
    icon: Brain
  },
  {
    title: "Real-time Updates",
    description: "Stay up-to-date with continuous data synchronization and instant updates.",
    icon: RefreshCw
  },
  {
    title: "Intelligent Summaries",
    description: "Get AI-generated daily summaries of the most important updates and developments.",
    icon: FileText
  },
  {
    title: "Structured Data",
    description: "Access well-organized data perfect for both human readers and AI agents.",
    icon: Database
  }
];

export function Features() {
  return (
    <section className="py-20 bg-background">
      <div className="container px-4 mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {features.map((feature, index) => (
            <motion.div key={index} variants={fadeIn}>
              <Card className="h-full">
                <CardHeader>
                  <feature.icon className="w-10 h-10 text-primary mb-4" />
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
